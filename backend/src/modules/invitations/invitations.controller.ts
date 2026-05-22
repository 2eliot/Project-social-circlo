import { Controller, Get, UseGuards } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { JwtAuthGuard } from '../../common/guards/auth.guards';
import { CurrentUser, AuthUser } from '../../common/decorators/auth.decorators';

@Controller('invitations')
@UseGuards(JwtAuthGuard)
export class InvitationsController {
  constructor(private readonly service: InvitationsService) {}

  @Get('me')
  getMine(@CurrentUser() user: AuthUser) {
    return this.service.getMine(user.id);
  }
}
