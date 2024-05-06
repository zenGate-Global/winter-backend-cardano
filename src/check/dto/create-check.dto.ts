import { recreateCommodity, tokenizeCommodity } from '../../types/job.dto';

export class CreateCheckDto {
  id: string;
  type: string;
  status: string;
  additionalInfo?: tokenizeCommodity | recreateCommodity;
}
