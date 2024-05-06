import { Controller, Get, Param } from '@nestjs/common';
import { CheckService } from './check.service';

@Controller('check')
export class CheckController {
  constructor(private readonly checkService: CheckService) {}

  @Get()
  findAll() {
    return this.checkService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.checkService.findOne(id);
  }
}
