import { HttpException, HttpStatus, BadRequestException } from '@nestjs/common';
import { GlobalExceptionFilter } from './http-exception.filter.js';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let mockResponse: { status: jest.Mock; json: jest.Mock };
  let mockHost: any;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockHost = {
      switchToHttp: jest.fn().mockReturnValue({
        getResponse: jest.fn().mockReturnValue(mockResponse),
      }),
    };
  });

  describe('non-production environment', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
    });

    it('should handle HttpException with string message', () => {
      const exception = new HttpException('Forbidden', HttpStatus.FORBIDDEN);

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          timestamp: expect.any(String),
        }),
      );
    });

    it('should handle HttpException with object response', () => {
      const exception = new BadRequestException({
        message: ['field is required'],
        error: 'Bad Request',
      });

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      const jsonArg = mockResponse.json.mock.calls[0][0];
      expect(jsonArg.statusCode).toBe(400);
      expect(jsonArg.timestamp).toBeDefined();
    });

    it('should handle non-HttpException as 500', () => {
      const exception = new Error('Something broke');

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          message: 'Internal server error',
        }),
      );
    });

    it('should handle non-Error exceptions as 500', () => {
      filter.catch('string-error', mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 500,
          message: 'Internal server error',
        }),
      );
    });

    it('should include ISO timestamp in response', () => {
      const exception = new HttpException('Test', 400);

      filter.catch(exception, mockHost);

      const jsonArg = mockResponse.json.mock.calls[0][0];
      // Verify it's a valid ISO string
      expect(new Date(jsonArg.timestamp).toISOString()).toBe(jsonArg.timestamp);
    });

    it('should expose HttpException message for 5xx in non-production', () => {
      const exception = new HttpException(
        'Service unavailable detail',
        HttpStatus.SERVICE_UNAVAILABLE,
      );

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(503);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 503,
          message: 'Service unavailable detail',
        }),
      );
    });
  });

  describe('production environment', () => {
    const originalEnv = process.env.NODE_ENV;

    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    it('should return generic message for unhandled 500 errors', () => {
      const exception = new Error('DB password is hunter2');

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      const jsonArg = mockResponse.json.mock.calls[0][0];
      expect(jsonArg.statusCode).toBe(500);
      expect(jsonArg.message).toBe('Internal server error');
      // Must NOT leak any internal detail
      expect(JSON.stringify(jsonArg)).not.toContain('hunter2');
    });

    it('should return generic message for HttpException with 5xx status in production', () => {
      const exception = new HttpException(
        'Database connection string: postgres://user:secret@host/db',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      const jsonArg = mockResponse.json.mock.calls[0][0];
      expect(jsonArg.message).toBe('Internal server error');
      expect(JSON.stringify(jsonArg)).not.toContain('secret');
    });

    it('should return generic message for 503 HttpException in production', () => {
      const exception = new HttpException(
        { message: 'Internal service detail', internalCode: 'DB_FAIL' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(503);
      const jsonArg = mockResponse.json.mock.calls[0][0];
      expect(jsonArg.message).toBe('Internal server error');
      expect(JSON.stringify(jsonArg)).not.toContain('DB_FAIL');
    });

    it('should still expose specific messages for 4xx errors in production', () => {
      const exception = new BadRequestException({
        message: ['email must be an email'],
        error: 'Bad Request',
      });

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      const jsonArg = mockResponse.json.mock.calls[0][0];
      expect(jsonArg.statusCode).toBe(400);
      expect(JSON.stringify(jsonArg)).toContain('email must be an email');
    });

    it('should include ISO timestamp in production response', () => {
      const exception = new Error('boom');

      filter.catch(exception, mockHost);

      const jsonArg = mockResponse.json.mock.calls[0][0];
      expect(new Date(jsonArg.timestamp).toISOString()).toBe(jsonArg.timestamp);
    });
  });
});
