import { Global, Module } from '@nestjs/common';
import { ImageService } from './pipes/image.service';

@Global()
@Module({
  providers: [ImageService],
  exports: [ImageService],
})
export class ImageModule {}
