import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RedeemInvitationUseCase } from '../invitations/use-cases/redeem-invitation.usecase';
import { loginSchema, registerSchema } from './dto/auth.dto';
import { JwtAuthGuard } from '../../common/guards/auth.guards';
import { CurrentUser, AuthUser } from '../../common/decorators/auth.decorators';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly redeemInvitation: RedeemInvitationUseCase,
  ) {}

  @Post('register')
  @HttpCode(201)
  async register(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());

    const user = await this.redeemInvitation.execute({
      ...parsed.data,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    const tokens = await this.auth.issueTokens(user.id, user.email, user.globalRole, false, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    this.auth.setRefreshCookie(res, tokens.refreshToken);
    return { user: tokens.user, accessToken: tokens.accessToken };
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const tokens = await this.auth.login(parsed.data.email, parsed.data.password, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    this.auth.setRefreshCookie(res, tokens.refreshToken);
    return { user: tokens.user, accessToken: tokens.accessToken };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = (req.cookies?.refresh_token as string | undefined) ?? '';
    const tokens = await this.auth.rotateRefresh(token, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    this.auth.setRefreshCookie(res, tokens.refreshToken);
    return { user: tokens.user, accessToken: tokens.accessToken };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.refresh_token as string | undefined);
    this.auth.clearRefreshCookie(res);
  }

  @Post('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
