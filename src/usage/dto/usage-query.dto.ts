import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';
import { MONTH_PATTERN } from '../usage-period.js';

export class UsageQueryDto {
  @ApiPropertyOptional({
    description:
      'Calendar month (UTC) to report, as YYYY-MM. Defaults to the current month. A future month is refused.',
    example: '2026-10',
    pattern: MONTH_PATTERN.source,
  })
  @IsOptional()
  @IsString()
  @Matches(MONTH_PATTERN, { message: 'month must be a YYYY-MM month' })
  month?: string;
}
