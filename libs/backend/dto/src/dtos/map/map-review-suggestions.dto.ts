import { Gamemode, MapReviewSuggestion } from '@momentum/constants';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { EnumProperty } from '../../decorators';

export class MapReviewSuggestionDto implements MapReviewSuggestion {
  @ApiProperty({ description: 'Track number the suggestion refers to' })
  @IsInt()
  track: number;

  @EnumProperty(Gamemode, { description: 'Gamemode the suggestion is for' })
  gamemode: Gamemode;

  @ApiProperty({ description: 'Track number the suggestion refers to' })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(10)
  tier: number;

  @ApiProperty({ description: 'Gameplay rating out of 10' })
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(10)
  gameplayRating: number;

  @ApiProperty({
    description: 'General comments about the track on this gamemode'
  })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  comment: string;
}