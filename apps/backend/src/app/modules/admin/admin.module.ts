import { Module, forwardRef } from '@nestjs/common';
import { DbModule } from '../database/db.module';
import { MapsModule } from '../maps/maps.module';
import { UsersModule } from '../users/users.module';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { AdminActivityService } from './admin-activity.service';

@Module({
  imports: [
    DbModule.forRoot(),
    forwardRef(() => MapsModule),
    forwardRef(() => UsersModule)
  ],
  controllers: [AdminController],
  providers: [AdminService, AdminActivityService],
  exports: [AdminActivityService]
})
export class AdminModule {}
