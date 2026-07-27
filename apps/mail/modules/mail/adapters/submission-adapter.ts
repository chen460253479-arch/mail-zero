import type { Submission } from '../model/submission';
import type { SubmissionDto } from './contracts';

export function adaptSubmission(dto: SubmissionDto): Submission {
  return { ...dto };
}
