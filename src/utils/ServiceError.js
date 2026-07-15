/**
 * Thrown by the service layer to signal a specific HTTP status back to the
 * client (validation failure, conflict, not-found, ...). Controllers never
 * catch this themselves - the global error handler in server.js does, so
 * controllers stay limited to "validate input, call service, return response."
 */
export class ServiceError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "ServiceError";
    this.statusCode = statusCode;
  }
}
