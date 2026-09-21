/**
 * SAMPLE DATA ONLY — Phase 1
 * Everything in this file is fake, for layout/demo purposes.
 * Later phases will replace this with real data pulled from Supabase
 * (mya_contacts, mya_conversations, mya_intakes, mya_notifications, mya_customer_profiles)
 * through a secure server-side API. Nothing here talks to the network.
 */

const SAMPLE_DATA = {

  kpis: {
    todaysCalls:    { value: 27,  trend: [4, 6, 5, 8, 7, 9, 11, 10, 13, 15, 18, 27] },
    newLeads:       { value: 6,   trend: [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6] },
    followUpsDue:   { value: 9,   trend: [2, 2, 3, 3, 4, 5, 5, 6, 7, 7, 8, 9] },
    openProjects:   { value: 14,  trend: [12, 12, 13, 13, 13, 14, 14, 14, 14, 14, 14, 14] }
  },

  systemStatus: [
    { name: "Phone Line",    state: "online",  detail: "Twilio — connected" },
    { name: "Database",      state: "online",  detail: "Supabase — connected" },
    { name: "Hermes Agent",  state: "offline", detail: "Not connected yet" },
    { name: "OpenAI",        state: "online",  detail: "ElevenLabs voice — connected" }
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

  todaysCalls: [
    { time: "9:41 AM", name: "Sample Customer A", topic: "Kitchen remodel estimate", outcome: "Estimate scheduled" },
    { time: "8:58 AM", name: "Sample Customer B", topic: "Deck addition inquiry", outcome: "New lead" },
    { time: "8:40 AM", name: "Sample Customer C", topic: "Missed call — general inquiry", outcome: "Callback queued" },
    { time: "8:02 AM", name: "Sample Customer G", topic: "Project status check-in", outcome: "Update provided" }
  ],

  followUpsDue: [
    { when: "Today, 11:00 AM",  name: "Sample Customer D", note: "Send bathroom renovation estimate" },
    { when: "Today, 2:30 PM",   name: "Sample Lead E",     note: "Callback re: fence installation quote" },
    { when: "Tomorrow, 9:00 AM", name: "Sample Customer H", note: "Confirm start date for roofing project" }
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

  recentActivity: [
    { time: "Today, 9:22 AM", text: "Follow-up reminder sent for Sample Project #204." },
    { time: "Today, 8:15 AM", text: "Vendor invoice logged for Sample Vendor F." },
    { time: "Yesterday, 4:50 PM", text: "Sample Project #198 status updated to 'In Progress'." },
    { time: "Yesterday, 2:10 PM", text: "Sample Customer H confirmed roofing project start date." }
  ],

  memoryInsights: {
    totalContactsRemembered: 128,
    recurringCustomers: 34,
    notesLoggedThisWeek: 19
  }

};
