import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateCheckDto } from './dto/create-check.dto';
import { UpdateCheckDto } from './dto/update-check.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Check } from './entities/check.entity';

@Injectable()
export class CheckService {
  constructor(
    @InjectRepository(Check)
    private readonly checkRepository: Repository<Check>,
    private readonly entityManager: EntityManager,
  ) {}
  async create(createCheckDto: CreateCheckDto) {
    const check = new Check(createCheckDto);
    await this.entityManager.save(check);
  }

  async findAll() {
    return await this.checkRepository.find();
  }

  async findOne(id: string) {
    const res = await this.checkRepository.findOneBy({ id });
    if (!res) {
      throw new BadRequestException('Not Found', {
        cause: 'Not Found',
        description: 'Not Found',
      });
    }
    return await this.checkRepository.findOneBy({ id });
  }

  async update(id: string, updateCheckDto: UpdateCheckDto) {
    const check = await this.findOne(id);
    check.status = updateCheckDto.status;
    check.txid = updateCheckDto.txid;
    check.error = updateCheckDto.error;
    await this.entityManager.save(check);
  }
}