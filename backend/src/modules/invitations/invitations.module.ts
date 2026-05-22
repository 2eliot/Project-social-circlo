import { Module } from '@nestjs/common';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { RedeemInvitationUseCase } from './use-cases/redeem-invitation.usecase';

@Module({
  controllers: [InvitationsController],
  providers: [InvitationsService, RedeemInvitationUseCase],
  exports: [InvitationsService, RedeemInvitationUseCase],
})
export class InvitationsModule {}
