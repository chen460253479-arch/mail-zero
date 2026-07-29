declare module 'nodemailer' {
  const nodemailer: {
    createTransport(options: unknown): unknown;
  };

  export default nodemailer;
}
