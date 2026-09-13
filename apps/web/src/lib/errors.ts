export class ServiceError extends Error {
  constructor(
    message: string,
    public code = "NETWORK_ERROR",
    public requestId?: string,
    public retryAfter?: number,
  ) {
    super(message);
  }
}
