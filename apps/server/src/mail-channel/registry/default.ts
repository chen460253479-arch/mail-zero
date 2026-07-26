import { createMailChannelRegistry } from './registry';
import { gmailPlugin } from '../gmail';

export const defaultMailChannelRegistry = createMailChannelRegistry([gmailPlugin]);
