/**
 * SAMPLE DATA ONLY — Phase 1
 * Everything in this file is fake, for layout/demo purposes.
 * Later phases will replace this with real data pulled from Supabase
 * (mya_contacts, mya_conversations, mya_intakes, mya_notifications, mya_customer_profiles)
 * through a secure server-side API. Nothing here talks to the network.
 */

const SAMPLE_DATA = {

  owner: { firstName: "Michael" },

  kpis: {
    todaysCalls:  { value: 27, icon: "☎", trendDirection: "up",   trendText: "+18% vs yesterday",  trend: [4, 6, 5, 8, 7, 9, 11, 10, 13, 15, 18, 27] },
    newLeads:     { value: 6,  icon: "✦", trendDirection: "up",   trendText: "+50% vs last week",  trend: [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6] },
    followUpsDue: { value: 9,  icon: "↻", trendDirection: "down", trendText: "-33% vs yesterday", trend: [2, 2, 3, 3, 4, 5, 5, 6, 7, 7, 8, 9] },
    openProjects: { value: 14, icon: "▣", trendDirection: "up",   trendText: "+17% vs last week",  trend: [12, 12, 13, 13, 13, 14, 14, 14, 14, 14, 14, 14] }
  },

  todaysSchedule: [
    { time: "10:00 AM", label: "Call with Sample Customer A (follow-up)" },
    { time: "11:30 AM", label: "Estimate review — Sample Project #204" },
    { time: "1:00 PM",  label: "Site visit — Sample Project #198" },
    { time: "3:00 PM",  label: "Call with new lead (intake)" },
    { time: "4:30 PM",  label: "Subcontractor follow-up" }
  ],

  activityFeed: [
    { time: "9:41 AM",  text: "Sample Customer A called about a kitchen remodel estimate.", severity: "info" },
    { time: "9:22 AM",  text: "Follow-up reminder sent for Sample Project #204.", severity: "info" },
    { time: "8:58 AM",  text: "New lead captured: Sample Customer B (deck addition).", severity: "success" },
    { time: "8:40 AM",  text: "Missed call from Sample Customer C — callback queued.", severity: "warning" },
    { time: "8:15 AM",  text: "Approval requested: Sample Vendor Invoice #1188.", severity: "warning" },
    { time: "7:55 AM",  text: "Daily briefing prepared.", severity: "info" }
  ],

  approvals: [
    {
      title: "Approve estimate for Sample Customer D",
      detail: "Bathroom renovation — $18,400 estimate ready to send.",
      requestedAgo: "12 minutes ago"
    },
    {
      title: "Approve callback script for Sample Lead E",
      detail: "Follow-up call about fence installation quote.",
      requestedAgo: "38 minutes ago"
    },
    {
      title: "Approve vendor invoice — Sample Vendor F",
      detail: "Materials invoice #1188 for $2,140 pending review.",
      requestedAgo: "1 hour ago"
    }
  ],

  workingNow: [
    "Drafting a follow-up email for Sample Customer A",
    "Preparing tomorrow's callback list",
    "Summarizing this morning's calls into project notes"
  ],

  newLeads: [
    { name: "Sample Customer B", source: "Phone", interest: "Deck addition", receivedAgo: "42 min ago" },
    { name: "Sample Lead E",     source: "Website form", interest: "Fence installation", receivedAgo: "1 hr ago" },
    { name: "Sample Customer I", source: "Phone", interest: "Kitchen remodel", receivedAgo: "3 hrs ago" }
  ],

  projectsNeedingAttention: [
    { name: "Sample Project #204", issue: "Awaiting customer approval on change order", days: 3 },
    { name: "Sample Project #198", issue: "Material delivery delayed", days: 1 },
    { name: "Sample Project #211", issue: "Inspection needs to be scheduled", days: 5 }
  ],

  memoryInsights: {
    totalContactsRemembered: 128,
    recurringCustomers: 34,
    notesLoggedThisWeek: 19
  },

  connectedServices: [
    { name: "Phone Line",   detail: "Twilio",     connected: true },
    { name: "Database",     detail: "Supabase",   connected: true },
    { name: "Voice Engine", detail: "ElevenLabs", connected: true },
    { name: "Hermes Agent", detail: "Not connected yet", connected: false }
  ],

  devices: [
    { name: "Sample Office PC",     status: "online" },
    { name: "Sample Mobile Device", status: "offline" },
    { name: "Mya Cloud",            status: "online" }
  ],

  contractors: [
    { category: "General/Builder", name: "Sample Builder Co.", phone: "555-010-0001", rate: "By the Job", notes: "New construction, general trades", addedInCrm: true },
    { category: "Electrician", name: "Sample Electric LLC", phone: "555-010-0002", rate: "By the Job", notes: "General electrical", addedInCrm: false },
    { category: "Plumber", name: "Sample Plumbing Co.", phone: "555-010-0003", rate: "By the Job", notes: "Plumbing repairs and installs", addedInCrm: true }
  ],

  quickActions: [
    { icon: "🖥",  label: "Take a Screenshot" },
    { icon: "↻",  label: "Create a Follow-Up" },
    { icon: "📄", label: "Generate a Report" },
    { icon: "⇧",  label: "Upload a File" },
    { icon: "⚙",  label: "Settings" }
  ]

};
