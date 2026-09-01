import { Controller, Get, Param, Query } from '@nestjs/common';
import { CheckService } from './check.service';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { PublicCheckDto, toPublicCheck } from './dto/public-check.dto';
@ApiTags('Check')
@Controller('check')
export class CheckController {
  constructor(private readonly checkService: CheckService) {}

  @Get()
  @ApiOkResponse({
    description: 'Returns all checks (default 50, max 200)',
    type: PublicCheckDto,
    isArray: true,
  })
  async findAll(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<PublicCheckDto[]> {
    const take = Math.min(Math.max(parseInt(limit ?? '50', 10) || 50, 1), 200);
    const skip = Math.max(parseInt(offset ?? '0', 10) || 0, 0);
    return (await this.checkService.findAll(take, skip)).map(toPublicCheck);
  }

  @Get(':id')
  @ApiOkResponse({
    description: 'Returns a check by id',
    type: PublicCheckDto,
  })
  async findOne(@Param('id') id: string): Promise<PublicCheckDto> {
    return toPublicCheck(await this.checkService.findOne(id));
  }
}
