import { redirect } from "next/navigation"
import {
  getLibreChatConversationUrl,
  getLibreChatPublicUrl,
} from "@/lib/auth/sso-bridge"

export const dynamic = "force-dynamic"

interface ChatPageProps {
  searchParams?: Promise<{
    thread?: string
  }>
}

export default async function ChatPage({ searchParams }: ChatPageProps) {
  const threadId = (await searchParams)?.thread?.trim()
  const destination = threadId
    ? getLibreChatConversationUrl(threadId)
    : getLibreChatPublicUrl()

  redirect(destination ?? "/")
}
