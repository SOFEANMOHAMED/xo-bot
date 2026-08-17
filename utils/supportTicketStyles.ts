/** Shared badge classes and Arabic labels for support tickets. */

export function supportTicketStatusColor(status: string): string {
  switch (status) {
    case 'open':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
    case 'in_progress':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
    case 'resolved':
      return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
    case 'closed':
      return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

export function supportTicketStatusLabel(status: string): string {
  switch (status) {
    case 'open':
      return 'مفتوحة';
    case 'in_progress':
      return 'قيد المعالجة';
    case 'resolved':
      return 'تم الحل';
    case 'closed':
      return 'مغلقة';
    default:
      return status;
  }
}

export function supportTicketPriorityColor(priority: string): string {
  switch (priority) {
    case 'urgent':
      return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';
    case 'high':
      return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300';
    case 'medium':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300';
    case 'low':
      return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

export function supportTicketPriorityLabel(priority: string): string {
  switch (priority) {
    case 'urgent':
      return 'عاجلة';
    case 'high':
      return 'عالية';
    case 'medium':
      return 'متوسطة';
    case 'low':
      return 'منخفضة';
    default:
      return priority;
  }
}
