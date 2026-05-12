import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Query,
  Body,
  Param,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiSecurity,
  ApiResponse,
} from '@nestjs/swagger';
import type { Realm } from '@prisma/client';
import type { Response } from 'express';
import { EventsService } from './events.service.js';
import { AuditExportService } from './audit-export.service.js';
import { AuditStreamsService } from './audit-streams.service.js';
import { RealmGuard } from '../common/guards/realm.guard.js';
import { CurrentRealm } from '../common/decorators/current-realm.decorator.js';
import { ExportEventsQueryDto } from './dto/export-events.dto.js';
import {
  CreateAuditStreamDto,
  UpdateAuditStreamDto,
} from './dto/audit-stream.dto.js';

@ApiTags('Events')
@Controller('admin/realms/:realmName')
@UseGuards(RealmGuard)
@ApiSecurity('admin-api-key')
export class EventsController {
  constructor(
    private readonly eventsService: EventsService,
    private readonly auditExportService: AuditExportService,
    private readonly auditStreamsService: AuditStreamsService,
  ) {}

  // ─── Login events ──────────────────────────────────────

  @Get('events')
  @ApiOperation({ summary: 'Query login events' })
  @ApiResponse({ status: 200, description: 'List of login events' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getLoginEvents(
    @CurrentRealm() realm: Realm,
    @Query('type') type?: string,
    @Query('userId') userId?: string,
    @Query('clientId') clientId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('first') first?: string,
    @Query('max') max?: string,
  ) {
    return this.eventsService.queryLoginEvents({
      realmId: realm.id,
      type,
      userId,
      clientId,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      first: first ? parseInt(first, 10) : undefined,
      max: max ? parseInt(max, 10) : undefined,
    });
  }

  @Delete('events')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Clear login events' })
  @ApiResponse({ status: 204, description: 'Login events cleared' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  clearLoginEvents(@CurrentRealm() realm: Realm) {
    return this.eventsService.clearLoginEvents(realm.id);
  }

  @Get('events/login/export')
  @ApiOperation({ summary: 'Export login events as JSON or CSV' })
  @ApiResponse({ status: 200, description: 'Login events export file' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async exportLoginEvents(
    @CurrentRealm() realm: Realm,
    @Query() query: ExportEventsQueryDto,
    @Res() res: Response,
  ) {
    // Do NOT call res.flushHeaders() here: flushing commits the response with
    // whatever headers are set at that moment (none), making it impossible for
    // the export service to set Content-Type / Content-Disposition afterwards.
    // The export service writes all headers before streaming data, so no
    // early flush is necessary.
    await this.auditExportService.exportLoginEvents(
      {
        realmId: realm.id,
        format: query.format,
        dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
        dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
        eventType: query.eventType,
        userId: query.userId,
        clientId: query.clientId,
        ipAddress: query.ipAddress,
        offset: query.offset,
        limit: query.limit,
      },
      res,
    );
  }

  // ─── Admin events ─────────────────────────────────────

  @Get('admin-events')
  @ApiOperation({ summary: 'Query admin events' })
  @ApiResponse({ status: 200, description: 'List of admin events' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  getAdminEvents(
    @CurrentRealm() realm: Realm,
    @Query('operationType') operationType?: string,
    @Query('resourceType') resourceType?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('first') first?: string,
    @Query('max') max?: string,
  ) {
    return this.eventsService.queryAdminEvents({
      realmId: realm.id,
      operationType,
      resourceType,
      dateFrom: dateFrom ? new Date(dateFrom) : undefined,
      dateTo: dateTo ? new Date(dateTo) : undefined,
      first: first ? parseInt(first, 10) : undefined,
      max: max ? parseInt(max, 10) : undefined,
    });
  }

  @Get('events/admin/export')
  @ApiOperation({ summary: 'Export admin events as JSON or CSV' })
  @ApiResponse({ status: 200, description: 'Admin events export file' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async exportAdminEvents(
    @CurrentRealm() realm: Realm,
    @Query() query: ExportEventsQueryDto,
    @Res() res: Response,
  ) {
    // Do NOT call res.flushHeaders() here — same reason as exportLoginEvents.
    await this.auditExportService.exportAdminEvents(
      {
        realmId: realm.id,
        format: query.format,
        dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
        dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
        eventType: query.eventType,
        userId: query.userId,
        clientId: query.clientId,
        ipAddress: query.ipAddress,
        offset: query.offset,
        limit: query.limit,
      },
      res,
    );
  }

  // ─── Audit log streams ────────────────────────────────

  @Post('audit-streams')
  @ApiOperation({ summary: 'Create an audit log stream destination' })
  @ApiResponse({ status: 201, description: 'Audit stream created' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  createStream(
    @CurrentRealm() realm: Realm,
    @Body() dto: CreateAuditStreamDto,
  ) {
    return this.auditStreamsService.create(realm, dto);
  }

  @Get('audit-streams')
  @ApiOperation({ summary: 'List audit log streams for a realm' })
  @ApiResponse({ status: 200, description: 'List of audit streams' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  listStreams(@CurrentRealm() realm: Realm) {
    return this.auditStreamsService.findAll(realm);
  }

  @Get('audit-streams/:id')
  @ApiOperation({ summary: 'Get a single audit log stream' })
  @ApiResponse({ status: 200, description: 'Audit stream details' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Audit stream not found' })
  getStream(@CurrentRealm() realm: Realm, @Param('id') id: string) {
    return this.auditStreamsService.findOne(realm, id);
  }

  @Put('audit-streams/:id')
  @ApiOperation({ summary: 'Update an audit log stream' })
  @ApiResponse({ status: 200, description: 'Audit stream updated' })
  @ApiResponse({ status: 400, description: 'Invalid request body' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Audit stream not found' })
  updateStream(
    @CurrentRealm() realm: Realm,
    @Param('id') id: string,
    @Body() dto: UpdateAuditStreamDto,
  ) {
    return this.auditStreamsService.update(realm, id, dto);
  }

  @Delete('audit-streams/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an audit log stream' })
  @ApiResponse({ status: 204, description: 'Audit stream deleted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Audit stream not found' })
  removeStream(@CurrentRealm() realm: Realm, @Param('id') id: string) {
    return this.auditStreamsService.remove(realm, id);
  }
}
