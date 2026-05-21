export interface Response {
  status: number           // Status code HTTP (ex: 200, 401, 403)
  statusCode: number       // Mesmo que status
  body: any               // Corpo da resposta (JSON)
  text: string            // Corpo da resposta como texto
  headers: Record<string, string>  // Headers da resposta
  header: Record<string, string>    // Mesmo que headers
  type: string            // Content-Type
  charset: string         // Charset do response
  redirects: string[]     // URLs de redirecionamento
  error: Error | false    // Erro se houver
  ok: boolean             // Status entre 200-299
  noContent: boolean      // Status 204 ou 304
  serverError: boolean    // Status >= 500
  clientError: boolean    // Status >= 400 e < 500
  accepted: boolean       // Status 202
  get(header: string): string | undefined  // Pegar header específico
}