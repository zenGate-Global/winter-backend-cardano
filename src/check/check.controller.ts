import {
  ClassSerializerInterceptor,
  Controller,
  Get,
  Param,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { CheckService } from './check.service';
import { Check } from './entities/check.entity';
import { ApiExtraModels, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { TokenizeCommodityDto } from '../palmyra/dto/tokenize-commodity.dto';
import { RecreateCommodityDto } from '../palmyra/dto/recreate-commodity.dto';

@ApiTags('Check')
@ApiExtraModels(TokenizeCommodityDto, RecreateCommodityDto)
@UseInterceptors(ClassSerializerInterceptor)
@Controller('check')
export class CheckController {
  constructor(private readonly checkService: CheckService) {}

  @Get()
  @ApiOkResponse({
    description: 'Returns all checks (default 50, max 200)',
    type: Check,
    isArray: true,
  })
  findAll(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<Check[]> {
    const take = Math.min(Math.max(parseInt(limit ?? '50', 10) || 50, 1), 200);
    const skip = Math.max(parseInt(offset ?? '0', 10) || 0, 0);
    return this.checkService.findAll(take, skip);
  }

  @Get(':id')
  @ApiOkResponse({
    description: 'Returns a check by id',
    type: Check,
  })
  findOne(@Param('id') id: string): Promise<Check> {
    return this.checkService.findOne(id);
  }
}
