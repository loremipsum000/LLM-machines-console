export const dynamic = "force-dynamic"

export async function GET() {
  return new Response("Not Found", {
    headers: { "Cache-Control": "no-store" },
    status: 404,
  })
}
