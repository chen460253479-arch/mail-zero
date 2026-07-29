declare module 'imapflow' {
  export class ImapFlow {
    constructor(options: Record<string, unknown>);
  }
}

declare module 'nodemailer' {
  const nodemailer: {
    createTransport(options: Record<string, unknown>): unknown;
  };
  export default nodemailer;
}
