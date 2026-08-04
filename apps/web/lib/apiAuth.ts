import { randomBytes, createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { prisma } from '@wildfire/db'

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' }

function errorResponse(status: number, error: string, extraHeaders?: Record<string, string>): NextResponse {
  return NextResponse.json({ error }, { status, headers: { ...JSON_HEADERS, ...extraHeaders } })
}

export function generateApiKey(): string {
  return `wf_${randomBytes(24).toString('base64url')}`
}

export function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export interface AuthedKey {
  id: string
  plan: string
}

/**
 * Leest `Authorization: Bearer <key>`, valideert tegen ApiKey.keyHash.
 * Geeft de key-rij terug, of een kant-en-klare 401-response.
 */
export async function authenticate(request: Request): Promise<
  { key: AuthedKey } | { error: NextResponse }
> {
  const header = request.headers.get('authorization') ?? ''
  const match  = /^Bearer\s+(.+)$/i.exec(header)

  if (!match) {
    return { error: errorResponse(401, 'Ontbrekende of ongeldige Authorization-header (verwacht: Bearer <key>)') }
  }

  const apiKey = await prisma.apiKey.findUnique({
    where:  { keyHash: hashKey(match[1]) },
    select: { id: true, plan: true },
  })

  if (!apiKey) {
    return { error: errorResponse(401, 'Onbekende API-key') }
  }

  return { key: apiKey }
}

export function jsonError(status: number, error: string, extraHeaders?: Record<string, string>): NextResponse {
  return errorResponse(status, error, extraHeaders)
}

export function jsonOk(body: unknown, extraHeaders?: Record<string, string>): NextResponse {
  return NextResponse.json(body, { headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store', ...extraHeaders } })
}
