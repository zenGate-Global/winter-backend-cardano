export class NoConfirmedFundingUtxoError extends Error {
  constructor(
    public readonly confirmedCount: number,
    public readonly unconfirmedCount: number,
  ) {
    super(
      `No confirmed funding UTxO is available (${confirmedCount} confirmed, ${unconfirmedCount} unconfirmed)`,
    );
    this.name = NoConfirmedFundingUtxoError.name;
  }
}
