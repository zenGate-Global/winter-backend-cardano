import { Controller, Get, Param } from '@nestjs/common';
import { CheckService } from './check.service';
import { Check } from './entities/check.entity';
import { ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('Check')
@Controller('check')
export class CheckController {
  constructor(private readonly checkService: CheckService) {}

  @Get()
  @ApiResponse({
    description: 'Returns all transactions',
    type: Check,
    isArray: true,
  })
  findAll(): Promise<Check[]> {
    return this.checkService.findAll();
  }

  @Get(':id')
  @ApiResponse({
    description: 'Returns a transaction by txid',
    type: Check,
  })
  findOne(@Param('id') id: string): Promise<Check> {
    return this.checkService.findOne(id);
  }
}
