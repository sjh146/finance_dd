import { Module } from '@nestjs/common';
import { ClosingChecklistService } from './closing-checklist.service';

/**
 * ClosingModule — monthly/quarterly closing checklist (PLAN §4.3).
 */
@Module({
  providers: [ClosingChecklistService],
  exports: [ClosingChecklistService],
})
export class ClosingModule {}
