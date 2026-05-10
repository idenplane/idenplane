import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RotationPolicyCredentialDto {
  @ApiProperty()
  credentialId!: string;

  @ApiProperty()
  nhiIdentityId!: string;

  @ApiProperty()
  name?: string;

  @ApiProperty()
  credentialType!: string;

  @ApiProperty()
  createdAt!: Date;
}

export class RotationRequiredCredentialDto extends RotationPolicyCredentialDto {
  @ApiProperty({ description: 'Why rotation is required' })
  reason!: string;

  @ApiPropertyOptional({ description: 'Applied policy ID' })
  policyId?: string;

  @ApiPropertyOptional({ description: 'Days until rotation is required' })
  daysUntilRotation?: number;
}

export class RotationPolicyStatusDto {
  @ApiProperty({ description: 'The credential that requires rotation' })
  credential!: RotationRequiredCredentialDto;

  @ApiProperty({ description: 'Whether rotation is required based on policy' })
  rotationRequired!: boolean;

  @ApiPropertyOptional({ description: 'Current policy that applies to this credential' })
  applicablePolicy?: {
    id: string;
    name: string;
    rotationIntervalDays: number;
    autoRotate: boolean;
  };

  @ApiPropertyOptional({ description: 'Days until forced rotation (max age)' })
  daysUntilForcedRotation?: number;

  @ApiPropertyOptional({ description: 'Days until rotation warning' })
  daysUntilRotationWarning?: number;
}

export class RotationPolicySummaryDto {
  @ApiProperty({ description: 'Total credentials requiring rotation' })
  totalRequiringRotation!: number;

  @ApiProperty({ description: 'Credentials due for rotation based on policy threshold' })
  dueForRotation!: number;

  @ApiProperty({ description: 'Credentials that must rotate due to max age' })
  mustRotate!: number;

  @ApiProperty({ description: 'Credentials with auto-rotate enabled' })
  autoRotateEnabled!: number;
}