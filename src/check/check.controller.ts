import { Controller, Get, Param } from '@nestjs/common';
import { CheckService } from './check.service';
import { Check } from './entities/check.entity';
import { ApiCreatedResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('Check')
@Controller('check')
export class CheckController {
  constructor(private readonly checkService: CheckService) {}

  @Get()
  @ApiCreatedResponse({
    description: 'Returns all transactions',
    type: Check,
    isArray: true,
  })
  findAll(): Promise<Check[]> {
    return this.checkService.findAll();
  }

  @Get(':id')
  @ApiCreatedResponse({
    description: 'Returns a transaction by txid',
    type: Check,
  })
  findOne(@Param('id') id: string): Promise<Check> {
    return this.checkService.findOne(id);
  }
}
