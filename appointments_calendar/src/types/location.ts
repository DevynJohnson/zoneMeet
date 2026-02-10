export interface ProviderLocation {
  id: string;
  timezone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city: string;
  stateProvince: string;
  postalCode?: string;
  country: string;
  description?: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  schedules?: LocationSchedule[];
}

export interface LocationSchedule {
  id: string;
  locationId: string;
  startDate: string;
  endDate?: string;
  
  // Recurring pattern options
  isRecurring: boolean;
  recurrenceType?: RecurrenceType;
  recurrenceInterval?: number;
  daysOfWeek: number[];
  weekOfMonth?: number;
  monthOfYear?: number;
  
  // End conditions for recurring patterns
  recurrenceEndDate?: string;
  occurrenceCount?: number;
  
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export enum RecurrenceType {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  BIWEEKLY = 'BIWEEKLY',
  MONTHLY = 'MONTHLY',
  BIMONTHLY = 'BIMONTHLY',
  QUARTERLY = 'QUARTERLY',
  YEARLY = 'YEARLY',
  CUSTOM = 'CUSTOM'
}

export interface LocationFormData {
  city: string;
  stateProvince: string;
  country: string;
  description: string;
  startDate: string;
  endDate: string;
  isDefault: boolean;
}

export interface ScheduleFormData {
  startDate: string;
  endDate: string;
  isRecurring: boolean;
  recurrenceType: RecurrenceType;
  recurrenceInterval: number;
  daysOfWeek: number[];
  weekOfMonth?: number;
  monthOfYear?: number;
  recurrenceEndDate: string;
  occurrenceCount?: number;
  endType: 'date' | 'count' | 'never';
}

export const RECURRENCE_TYPE_LABELS = {
  [RecurrenceType.DAILY]: 'Daily',
  [RecurrenceType.WEEKLY]: 'Weekly', 
  [RecurrenceType.BIWEEKLY]: 'Every 2 weeks',
  [RecurrenceType.MONTHLY]: 'Monthly',
  [RecurrenceType.BIMONTHLY]: 'Every 2 months',
  [RecurrenceType.QUARTERLY]: 'Quarterly',
  [RecurrenceType.YEARLY]: 'Yearly',
  [RecurrenceType.CUSTOM]: 'Custom'
};

export const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday', short: 'Sun' },
  { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' },
  { value: 5, label: 'Friday', short: 'Fri' },
  { value: 6, label: 'Saturday', short: 'Sat' }
];