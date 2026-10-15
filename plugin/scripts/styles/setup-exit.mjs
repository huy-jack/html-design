// A setup stop with its exit code: setup prints the message and exits with the code.
export class SetupExit extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}
