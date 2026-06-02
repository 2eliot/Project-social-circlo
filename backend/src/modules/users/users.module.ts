import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { ReputationService } from './reputation.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService, ReputationService],
  exports: [UsersService, ReputationService],
})
export class UsersModule {}
