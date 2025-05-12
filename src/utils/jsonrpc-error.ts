export enum RpcCode {
  // JSON‑RPC 2.0 core
  PARSE_ERROR = -32700,
  INVALID_REQUEST = -32600,
  METHOD_NOT_FOUND = -32601,
  INVALID_PARAMS = -32602,
  INTERNAL_ERROR = -32603,
  // App‑specific
  API_KEY_REQUIRED = -32001,
  API_KEY_INVALID = -32002
}

export class McpError extends Error {
  constructor(
    public code: RpcCode,
    message: string,
    public id: string | number | null = null
  ) {
    super(message)
    this.name = 'McpError'
  }

  toJSON() {
    return { jsonrpc: '2.0', error: { code: this.code, message: this.message }, id: this.id }
  }

  get httpStatus(): number {
    if (this.code === RpcCode.API_KEY_REQUIRED || this.code === RpcCode.API_KEY_INVALID) return 401
    if (this.code <= -32000 && this.code >= -32099) return 400
    return 500
  }
}
