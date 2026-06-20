"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  BarChart3,
  ChevronRight,
  Database,
  HardDrive,
  Mail,
  MessageSquare,
  Radio,
  Settings,
  Workflow,
  Zap,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"

const navItems = [
  {
    title: "Overview",
    url: "/",
    icon: BarChart3,
  },
  {
    title: "Events",
    icon: Mail,
    items: [
      { title: "Emit", url: "/events/emit" },
      { title: "Subscribe", url: "/events/subscribe" },
      { title: "Patterns", url: "/events/patterns" },
      { title: "Filtering (CEL)", url: "/events/filtering" },
      { title: "Replay", url: "/events/replay" },
      { title: "Webhooks", url: "/events/webhooks" },
    ],
  },
  {
    title: "Pub/Sub",
    icon: MessageSquare,
    items: [
      { title: "Topics", url: "/pubsub/topics" },
      { title: "Publish", url: "/pubsub/publish" },
      { title: "Subscribe", url: "/pubsub/subscribe" },
    ],
  },
  {
    title: "Workflows",
    icon: Workflow,
    items: [
      { title: "Trigger", url: "/workflows/trigger" },
      { title: "Runs", url: "/workflows/runs" },
      { title: "Steps", url: "/workflows/steps" },
      { title: "Parallel & Map", url: "/workflows/parallel" },
      { title: "Hot Patching", url: "/workflows/hot-patch" },
      { title: "Cron", url: "/workflows/cron" },
      { title: "Invoke", url: "/workflows/invoke" },
      { title: "Sagas", url: "/workflows/sagas" },
      { title: "Timeouts", url: "/workflows/timeouts" },
      { title: "Secrets", url: "/workflows/secrets" },
    ],
  },
  {
    title: "Event Sourcing",
    icon: Database,
    items: [
      { title: "Streams", url: "/event-sourcing/streams" },
      { title: "Subscribe", url: "/event-sourcing/subscribe" },
      { title: "Projections", url: "/event-sourcing/projections" },
      { title: "Upcasting", url: "/event-sourcing/upcasting" },
    ],
  },
  {
    title: "KV Store",
    icon: HardDrive,
    items: [
      { title: "Buckets", url: "/kv/buckets" },
      { title: "Keys", url: "/kv/keys" },
      { title: "Watch", url: "/kv/watch" },
    ],
  },
  {
    title: "Real-time",
    icon: Radio,
    items: [
      { title: "Connection", url: "/realtime/connection" },
      { title: "Consumer Groups", url: "/realtime/consumer-groups" },
      { title: "Workers", url: "/realtime/workers" },
      { title: "Concurrency & Actors", url: "/realtime/concurrency" },
    ],
  },
  {
    title: "Config",
    icon: Settings,
    items: [
      { title: "Configs", url: "/config/configs" },
      { title: "Editor", url: "/config/editor" },
      { title: "Watch", url: "/config/watch" },
    ],
  },
]

export function AppSidebar() {
  const pathname = usePathname()

  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Zap className="size-4" />
                </div>
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="font-semibold">Ironflow Demo</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                // Check if this item has sub-items (collapsible)
                if (item.items) {
                  // Check if any child is active
                  const isChildActive = item.items.some(
                    (subItem) => pathname === subItem.url
                  )

                  return (
                    <Collapsible
                      key={item.title}
                      asChild
                      defaultOpen={isChildActive}
                      className="group/collapsible"
                    >
                      <SidebarMenuItem>
                        <CollapsibleTrigger asChild>
                          <SidebarMenuButton tooltip={item.title}>
                            {item.icon && <item.icon />}
                            <span>{item.title}</span>
                            <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                          </SidebarMenuButton>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <SidebarMenuSub>
                            {item.items.map((subItem) => (
                              <SidebarMenuSubItem key={subItem.title}>
                                <SidebarMenuSubButton
                                  asChild
                                  isActive={pathname === subItem.url}
                                >
                                  <Link href={subItem.url}>
                                    <span>{subItem.title}</span>
                                  </Link>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            ))}
                          </SidebarMenuSub>
                        </CollapsibleContent>
                      </SidebarMenuItem>
                    </Collapsible>
                  )
                }

                // Regular menu item (Overview)
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === item.url}
                      tooltip={item.title}
                    >
                      <Link href={item.url}>
                        {item.icon && <item.icon />}
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  )
}
