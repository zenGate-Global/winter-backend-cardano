export class InsufficientConfirmedFundingError extends Error {
  constructor(cause: unknown) {
    super('Confirmed funding UTxOs cannot cover the transaction', { cause });
    this.name = InsufficientConfirmedFundingError.name;
  }
}
