import { ApiProperty } from '@nestjs/swagger';
import type { InstanceUsage, RealmUsage } from '../usage.service.js';

/** OpenAPI shape of GET /admin/system/usage (see InstanceUsage). */
export class UsagePeriodDto {
  @ApiProperty({ example: '2026-10', description: 'Calendar month, UTC' })
  month!: string;

  @ApiProperty({
    example: '2026-10-01T00:00:00.000Z',
    description: 'First instant of the month (inclusive)',
  })
  start!: string;

  @ApiProperty({
    example: '2026-11-01T00:00:00.000Z',
    description: 'First instant of the next month (exclusive)',
  })
  end!: string;

  @ApiProperty({
    description: 'The month is over, so its count can no longer change',
  })
  closed!: boolean;

  @ApiProperty({
    description:
      'Activity was recorded for the whole month. False when the month starts before tracking.since: the count is then a lower bound.',
  })
  complete!: boolean;

  @ApiProperty({
    description:
      'The month is older than the activity retention and has been deleted: its counts are not available (not the same as no activity). Then complete is false.',
  })
  pruned!: boolean;
}

export class UsageRetentionDto {
  @ApiProperty({
    type: Number,
    nullable: true,
    example: 13,
    description:
      'Whole months kept before the current one (USAGE_ACTIVITY_RETENTION_MONTHS); null when pruning is off',
  })
  months!: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '2025-10',
    description:
      'YYYY-MM: the oldest month whose activity is kept; null when nothing has been or will be pruned',
  })
  oldestMonth!: string | null;
}

export class UsageTrackingDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: '2026-11-19T12:00:00.000Z',
    description: 'When this instance started recording activity',
  })
  since!: string | null;
}

export class UsageTotalsDto {
  @ApiProperty({ description: 'Realms that exist now' })
  realms!: number;

  @ApiProperty({
    description: 'User accounts now, all realms, service accounts excluded',
  })
  users!: number;

  @ApiProperty({
    description: 'Distinct users who authenticated in the month, all realms',
  })
  monthlyActiveUsers!: number;
}

export class RealmUsageDto implements RealmUsage {
  @ApiProperty()
  id!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Null for a deleted realm',
  })
  name!: string | null;

  @ApiProperty({
    description:
      'The realm no longer exists; its activity in the month still counts',
  })
  deleted!: boolean;

  @ApiProperty({ description: 'User accounts now, service accounts excluded' })
  users!: number;

  @ApiProperty({
    description: 'Distinct users who authenticated in the month',
  })
  monthlyActiveUsers!: number;
}

export class InstanceUsageDto implements InstanceUsage {
  @ApiProperty({ example: '0.13.1' })
  version!: string;

  @ApiProperty({ example: '2026-11-02T08:00:00.000Z' })
  generatedAt!: string;

  @ApiProperty({ type: UsagePeriodDto })
  period!: UsagePeriodDto;

  @ApiProperty({ type: UsageTrackingDto })
  tracking!: UsageTrackingDto;

  @ApiProperty({ type: UsageRetentionDto })
  retention!: UsageRetentionDto;

  @ApiProperty({ type: UsageTotalsDto })
  totals!: UsageTotalsDto;

  @ApiProperty({ type: [RealmUsageDto] })
  realms!: RealmUsageDto[];
}
