"use client";

import { useState, useEffect, useRef } from "react";
import { Plus, Calendar, Clock, Settings, Trash2, Edit } from "lucide-react";
import { secureFetch } from "@/lib/csrf";
import { useAlert } from "@/contexts/AlertContext";

interface ScheduleFormData {
  name: string;
  startDate: Date;
  endDate?: Date;
  isRecurring?: boolean;
  recurrenceInterval?: number; // Number of weeks between repeats
  timeSlots: Array<{
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    isEnabled: boolean;
    weekNumber?: number;
  }>;
}

interface Schedule {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date | null;
  isRecurring: boolean;
  recurrenceType: string | null;
  recurrenceInterval: number | null;
  daysOfWeek: number[];
  weekOfMonth: number | null;
  monthOfYear: number | null;
  recurrenceEndDate: Date | null;
  occurrenceCount: number | null;
  isActive: boolean;
  priority: number;
  timeSlots: Array<{
    id: string;
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    isEnabled: boolean;
    weekNumber?: number;
  }>;
}

interface WeeklyPattern {
  weekNumber: number;
  days: {
    [dayOfWeek: number]: {
      enabled: boolean;
      startTime: string;
      endTime: string;
    };
  };
}

interface AdvancedAvailabilityEditorProps {
  templateId: string;
  onScheduleChange?: () => void;
}

export default function AdvancedAvailabilityEditor({
  templateId,
  onScheduleChange,
}: AdvancedAvailabilityEditorProps) {
  const { showError, showConfirm } = useAlert();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);

  const dayNames = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];

  // Helper function to format 24-hour time to 12-hour format
  const formatTime = (time24: string): string => {
    const [hours, minutes] = time24.split(":").map(Number);
    const period = hours >= 12 ? "PM" : "AM";
    const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    return `${hours12}:${minutes.toString().padStart(2, "0")} ${period}`;
  };

  useEffect(() => {
    const loadSchedules = async () => {
      try {
        setIsLoading(true);
        const response = await secureFetch(
          `/api/provider/advanced-availability?templateId=${templateId}`
        );
        if (!response.ok) throw new Error("Failed to fetch schedules");
        const data = await response.json();
        setSchedules(data);
      } catch (error) {
        console.error("Failed to load schedules:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadSchedules();
  }, [templateId]);

  const loadSchedules = async () => {
    try {
      setIsLoading(true);
      const response = await secureFetch(
        `/api/provider/advanced-availability?templateId=${templateId}`
      );
      if (!response.ok) throw new Error("Failed to fetch schedules");
      const data = await response.json();
      setSchedules(data);
    } catch (error) {
      console.error("Failed to load schedules:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateSchedule = () => {
    setEditingSchedule(null);
    setShowCreateModal(true);
  };

  const handleEditSchedule = (schedule: Schedule) => {
    setEditingSchedule(schedule);
    setShowCreateModal(true);
  };

  const handleDeleteSchedule = async (scheduleId: string) => {
    showConfirm(
      "Are you sure you want to delete this schedule?",
      async () => {
        try {
          const response = await secureFetch(
            `/api/provider/advanced-availability/${scheduleId}`,
            {
              method: "DELETE",
            }
          );
          if (!response.ok) throw new Error("Failed to delete schedule");

          await loadSchedules();
          onScheduleChange?.();
        } catch (error) {
          console.error("Failed to delete schedule:", error);
          showError("Failed to delete schedule");
        }
      },
      "Delete Schedule"
    );
  };

  const handleToggleActive = async (scheduleId: string, currentStatus: boolean) => {
    try {
      const token = localStorage.getItem('providerToken');
      const response = await secureFetch(
        `/api/provider/advanced-availability/${scheduleId}`,
        {
          method: "PATCH",
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ isActive: !currentStatus }),
        }
      );
      
      if (!response.ok) {
        throw new Error("Failed to update schedule status");
      }

      await loadSchedules();
      onScheduleChange?.();
    } catch (error) {
      console.error("Failed to toggle schedule status:", error);
      showError("Failed to update schedule status");
    }
  };

  const formatRecurrence = (schedule: Schedule) => {
    if (!schedule.isRecurring) return "One-time";

    const interval = schedule.recurrenceInterval || 1;
    const type = schedule.recurrenceType;
    const days = schedule.daysOfWeek.map((d) => dayNames[d]).join(", ");

    switch (type) {
      case "DAILY":
        return interval === 1 ? "Daily" : `Every ${interval} days`;
      case "WEEKLY":
        return `${
          interval === 1 ? "Weekly" : `Every ${interval} weeks`
        } on ${days}`;
      case "BIWEEKLY":
        return `Every other week on ${days}`;
      case "MONTHLY":
        if (schedule.weekOfMonth) {
          const weekOrder = ["", "1st", "2nd", "3rd", "4th"][
            schedule.weekOfMonth
          ];
          return `${weekOrder} week of each month on ${days}`;
        }
        return `Monthly on ${days}`;
      default:
        return "Custom";
    }
  };

  const formatTimeSlots = (timeSlots: Schedule["timeSlots"]) => {
    if (timeSlots.length === 0) return "No time slots configured";

    const slotsByDay = timeSlots.reduce((acc, slot) => {
      if (!acc[slot.dayOfWeek]) acc[slot.dayOfWeek] = [];
      acc[slot.dayOfWeek].push(
        `${formatTime(slot.startTime)} - ${formatTime(slot.endTime)}`
      );
      return acc;
    }, {} as Record<number, string[]>);

    return { slotsByDay };
  };

  // Component to render the time slots in a week-by-week pattern
  const TimeSlotDisplay = ({ timeSlots }: { timeSlots: Schedule['timeSlots'] }) => {
  const formatted = formatTimeSlots(timeSlots);
  
  if (typeof formatted === 'string') {
    return <span className="text-gray-600">{formatted}</span>;
  }

  // Check if we have weekNumber data in the time slots
  const hasWeekNumbers = timeSlots.some(slot => slot.weekNumber != null);
  
  if (hasWeekNumbers) {
    // Group slots by week number
    const weekPattern: { [week: number]: { [day: number]: string[] } } = {};
    
    timeSlots.forEach(slot => {
      const weekNum = slot.weekNumber ?? 0;
      const dayNum = slot.dayOfWeek;
      
      if (!weekPattern[weekNum]) weekPattern[weekNum] = {};
      if (!weekPattern[weekNum][dayNum]) weekPattern[weekNum][dayNum] = [];
      
      weekPattern[weekNum][dayNum].push(`${formatTime(slot.startTime)} - ${formatTime(slot.endTime)}`);
    });

    const sortedWeeks = Object.keys(weekPattern).map(Number).sort((a, b) => a - b);

    return (
      <div className="space-y-2">
        {sortedWeeks.map((weekNum) => {
          const weekData = weekPattern[weekNum];
          const sortedDays = Object.entries(weekData)
            .sort(([a], [b]) => parseInt(a) - parseInt(b));

          return (
            <div key={weekNum} className="text-xs">
              <div className="font-medium text-gray-700 mb-1">
                Week {weekNum + 1}:
              </div>
              <div className="pl-2 space-y-0.5">
                {sortedDays.map(([dayStr, times]) => {
                  const dayName = dayNames[parseInt(dayStr)];
                  return (
                    <div key={dayStr} className="text-gray-600 flex">
                      <span className="font-medium w-20">{dayName}:</span>
                      <span>{times.join(', ')}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {sortedWeeks.length > 1 && (
          <div className="text-xs text-gray-500 italic">
            (Pattern repeats every {sortedWeeks.length} weeks)
          </div>
        )}
      </div>
    );
  }

  // Fallback for schedules without week numbers - show simple list
  const sortedDays = Object.entries(formatted.slotsByDay)
    .sort(([a], [b]) => parseInt(a) - parseInt(b));

  return (
    <div className="space-y-1">
      {sortedDays.map(([dayStr, times]) => {
        const dayName = dayNames[parseInt(dayStr)];
        return (
          <div key={dayStr} className="text-xs text-gray-600">
            <span className="font-medium">{dayName}:</span> {times.join(', ')}
          </div>
        );
      })}
    </div>
  );
};

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-6 bg-gray-200 rounded animate-pulse"></div>
        <div className="h-32 bg-gray-200 rounded animate-pulse"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Calendar className="w-5 h-5 text-blue-600" />
          <h3 className="text-lg font-semibold">
            Advanced Availability Schedules
          </h3>
        </div>
        <button
          onClick={handleCreateSchedule}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>New Schedule</span>
        </button>
      </div>

      {/* Description */}
      <div className="text-sm text-gray-600 bg-blue-50 p-4 rounded-lg">
        <p className="mb-2">
          <strong>Advanced Schedules</strong> allow you to create complex
          availability patterns beyond simple daily hours.
        </p>
        <ul className="list-disc list-inside space-y-1">
          <li>
            Create recurring schedules (every other week, monthly, seasonal)
          </li>
          <li>Override availability for specific date ranges</li>
          <li>Set different hours for different periods</li>
          <li>
            Multiple schedules can overlap - newer schedules take precedence
          </li>
          <li>Use the toggle button to activate or deactivate schedules</li>
        </ul>
      </div>

      {/* Schedules List */}
      <div className="space-y-4">
        {schedules.length === 0 ? (
          <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-lg">
            <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500 mb-2">
              No advanced schedules configured
            </p>
            <p className="text-sm text-gray-400 mb-4">
              Create your first advanced schedule to set up complex availability
              patterns
            </p>
            <button
              onClick={handleCreateSchedule}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              Create Schedule
            </button>
          </div>
        ) : (
          schedules.map((schedule) => (
            <div
              key={schedule.id}
              className="border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-3 mb-2">
                    <h4 className="font-medium text-gray-900">
                      {schedule.name}
                    </h4>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleActive(schedule.id, schedule.isActive);
                      }}
                      className={`px-2 py-1 text-xs font-medium rounded-full transition-colors ${
                        schedule.isActive
                          ? 'text-green-700 bg-green-100 hover:bg-green-200'
                          : 'text-gray-500 bg-gray-100 hover:bg-gray-200'
                      }`}
                      title={schedule.isActive ? 'Click to deactivate' : 'Click to activate'}
                    >
                      {schedule.isActive ? '✓ Active' : 'Inactive'}
                    </button>
                  </div>

                  <div className="space-y-2 text-sm text-gray-600">
                    <div className="flex items-center space-x-2">
                      <Calendar className="w-4 h-4" />
                      <span>
                        {new Date(schedule.startDate).toLocaleDateString()}
                        {schedule.endDate &&
                          ` - ${new Date(
                            schedule.endDate
                          ).toLocaleDateString()}`}
                      </span>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Settings className="w-4 h-4" />
                      <span>{formatRecurrence(schedule)}</span>
                    </div>

                    <div className="flex items-start space-x-2">
                      <Clock className="w-4 h-4 mt-0.5" />
                      <TimeSlotDisplay timeSlots={schedule.timeSlots} />
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-2 ml-4 flex-shrink-0">
                  <button
                    onClick={() => handleEditSchedule(schedule)}
                    onTouchEnd={(e) => {
                      e.preventDefault();
                      handleEditSchedule(schedule);
                    }}
                    className="p-3 text-gray-400 hover:text-blue-600 active:text-blue-700 transition-colors touch-manipulation"
                    title="Edit schedule"
                  >
                    <Edit className="w-5 h-5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteSchedule(schedule.id);
                    }}
                    onTouchEnd={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDeleteSchedule(schedule.id);
                    }}
                    className="p-3 text-gray-400 hover:text-red-600 active:text-red-700 transition-colors touch-manipulation"
                    title="Delete schedule"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Create/Edit Modal */}
      {showCreateModal && (
        <ScheduleModal
          templateId={templateId}
          schedule={editingSchedule}
          onClose={() => {
            setShowCreateModal(false);
            setEditingSchedule(null);
          }}
          onSave={async () => {
            await loadSchedules();
            onScheduleChange?.();
            setShowCreateModal(false);
            setEditingSchedule(null);
          }}
          showError={showError}
        />
      )}
    </div>
  );
}

// Schedule Creation/Edit Modal Component
interface ScheduleModalProps {
  templateId: string;
  schedule: Schedule | null;
  onClose: () => void;
  onSave: () => void;
  showError: (message: string) => void;
}

function ScheduleModal({
  templateId,
  schedule,
  onClose,
  onSave,
  showError,
}: ScheduleModalProps) {
  const [formData, setFormData] = useState<Partial<ScheduleFormData>>(() => {
    if (schedule) {
      return {
        name: schedule.name,
        startDate: schedule.startDate
          ? new Date(schedule.startDate)
          : new Date(),
        endDate: schedule.endDate ? new Date(schedule.endDate) : undefined,
        isRecurring: schedule.isRecurring ?? false,
        recurrenceInterval: schedule.recurrenceInterval ?? 1,
        timeSlots:
          schedule.timeSlots?.map((slot) => ({
            dayOfWeek: slot.dayOfWeek,
            startTime: slot.startTime,
            endTime: slot.endTime,
            isEnabled: slot.isEnabled,
          })) || [],
      };
    }
    return {
      name: "",
      startDate: new Date(),
      endDate: undefined,
      isRecurring: false,
      recurrenceInterval: 1,
      timeSlots: [],
    };
  });

  // Weekly pattern state for complex scheduling
  const [weeklyPatterns, setWeeklyPatterns] = useState<WeeklyPattern[]>(() => {
    const patterns: WeeklyPattern[] = [];

    if (schedule?.timeSlots && schedule.timeSlots.length > 0) {
      // Group time slots by week number
      const slotsByWeek: { [week: number]: typeof schedule.timeSlots } = {};

      schedule.timeSlots.forEach((slot) => {
        // If slot has weekNumber, use it; otherwise assume week 0
        const weekNum = slot.weekNumber ?? 0;
        if (!slotsByWeek[weekNum]) {
          slotsByWeek[weekNum] = [];
        }
        slotsByWeek[weekNum].push(slot);
      });

      // Determine number of weeks (at least 1)
      const numWeeks = Math.max(Object.keys(slotsByWeek).length, 1);

      // Create patterns for each week
      for (let week = 0; week < numWeeks; week++) {
        const weekPattern: WeeklyPattern = {
          weekNumber: week + 1,
          days: {},
        };

        // Initialize all days as disabled
        for (let day = 0; day < 7; day++) {
          weekPattern.days[day] = {
            enabled: false,
            startTime: "09:00",
            endTime: "17:00",
          };
        }

        // Populate from this week's slots
        const weekSlots = slotsByWeek[week] || [];
        weekSlots.forEach((slot) => {
          if (slot.isEnabled) {
            weekPattern.days[slot.dayOfWeek] = {
              enabled: true,
              startTime: slot.startTime,
              endTime: slot.endTime,
            };
          }
        });

        patterns.push(weekPattern);
      }
    } else {
      // Default to 1 week for new schedules
      const weekPattern: WeeklyPattern = {
        weekNumber: 1,
        days: {},
      };

      for (let day = 0; day < 7; day++) {
        weekPattern.days[day] = {
          enabled: false,
          startTime: "09:00",
          endTime: "17:00",
        };
      }

      patterns.push(weekPattern);
    }

    return patterns;
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const dayNames = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const dayNamesShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // Functions to manage weeks
  const addWeek = () => {
    setWeeklyPatterns((prev) => {
      const newWeek: WeeklyPattern = {
        weekNumber: prev.length + 1,
        days: {},
      };

      // Initialize all days as disabled
      for (let day = 0; day < 7; day++) {
        newWeek.days[day] = {
          enabled: false,
          startTime: "09:00",
          endTime: "17:00",
        };
      }

      return [...prev, newWeek];
    });
  };

  const removeWeek = (weekIndex: number) => {
    if (weeklyPatterns.length > 1) {
      // Keep at least one week
      setWeeklyPatterns((prev) => {
        const newPatterns = prev.filter((_, index) => index !== weekIndex);
        // Renumber the remaining weeks
        return newPatterns.map((pattern, index) => ({
          ...pattern,
          weekNumber: index + 1,
        }));
      });
    }
  };

  // Track the last toggle to prevent double execution in Strict Mode
  const lastToggleRef = useRef<{
    weekIndex: number;
    dayOfWeek: number;
    timestamp: number;
  } | null>(null);

  const toggleDayInPattern = (weekIndex: number, dayOfWeek: number) => {
    const now = Date.now();
    const lastToggle = lastToggleRef.current;

    // Prevent rapid double-clicks (within 100ms) which is typical for Strict Mode
    if (
      lastToggle &&
      lastToggle.weekIndex === weekIndex &&
      lastToggle.dayOfWeek === dayOfWeek &&
      now - lastToggle.timestamp < 100
    ) {
      return;
    }

    lastToggleRef.current = { weekIndex, dayOfWeek, timestamp: now };

    setWeeklyPatterns((prev) => {
      // Create a deep copy to avoid mutations
      const newPatterns = prev.map((pattern) => ({
        ...pattern,
        days: { ...pattern.days },
      }));

      // Ensure the week pattern exists
      if (!newPatterns[weekIndex]) {
        newPatterns[weekIndex] = { weekNumber: weekIndex + 1, days: {} };
      }

      const currentDay = newPatterns[weekIndex].days[dayOfWeek];

      if (!currentDay) {
        newPatterns[weekIndex].days[dayOfWeek] = {
          enabled: true,
          startTime: "09:00",
          endTime: "17:00",
        };
      } else {
        newPatterns[weekIndex].days[dayOfWeek] = {
          ...currentDay,
          enabled: !currentDay.enabled,
        };
      }

      return newPatterns;
    });
  };

  const updateDayTime = (
    weekIndex: number,
    dayOfWeek: number,
    field: "startTime" | "endTime",
    value: string
  ) => {
    setWeeklyPatterns((prev) => {
      const newPatterns = [...prev];
      newPatterns[weekIndex].days[dayOfWeek] = {
        ...newPatterns[weekIndex].days[dayOfWeek],
        [field]: value,
      };
      return newPatterns;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.startDate) return;

    try {
      setIsSubmitting(true);

      // Convert weekly patterns to time slots and days of week
      const timeSlots: Array<{
        dayOfWeek: number;
        startTime: string;
        endTime: string;
        isEnabled: boolean;
        weekNumber?: number;
      }> = [];

      const daysOfWeek: number[] = [];

      weeklyPatterns.forEach((pattern, weekIndex) => {
        Object.entries(pattern.days).forEach(([dayStr, dayData]) => {
          const dayOfWeek = parseInt(dayStr);
          if (dayData.enabled) {
            timeSlots.push({
              dayOfWeek,
              startTime: dayData.startTime,
              endTime: dayData.endTime,
              isEnabled: true,
              weekNumber: weekIndex, // ADD THIS LINE
            });

            if (!daysOfWeek.includes(dayOfWeek)) {
              daysOfWeek.push(dayOfWeek);
            }
          }
        });
      });

      const scheduleData = {
        name: formData.name,
        startDate: formData.startDate,
        endDate: formData.endDate,
        isRecurring: (formData.recurrenceInterval ?? 1) > 1,
        recurrenceType: "WEEKLY",
        recurrenceInterval: formData.recurrenceInterval,
        weekOfMonth: null,
        monthOfYear: null,
        recurrenceEndDate: null,
        occurrenceCount: null,
        priority: 0, // Default priority for all schedules
        timeSlots,
        daysOfWeek: daysOfWeek.sort(),
      };

      if (schedule) {
        const response = await secureFetch(
          `/api/provider/advanced-availability/${schedule.id}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(scheduleData),
          }
        );
        if (!response.ok) throw new Error("Failed to update schedule");
      } else {
        console.log("Sending data to API:", { templateId, scheduleData });
        const response = await secureFetch(
          "/api/provider/advanced-availability",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ templateId, scheduleData }),
          }
        );

        if (!response.ok) {
          const errorData = await response.text();
          console.error("API Error Response:", errorData);
          throw new Error(
            `Failed to create schedule: ${response.status} - ${errorData}`
          );
        }
      }

      onSave();
    } catch (error) {
      console.error("Failed to save schedule:", error);
      showError("Failed to save schedule");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">
              {schedule ? "Edit Schedule" : "Create New Schedule"}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </div>

          {/* Basic Info */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Schedule Name *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder="e.g., Summer Hours, Holiday Schedule"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Recurrence Interval (weeks)
              </label>
              <input
                type="number"
                min={1}
                value={formData.recurrenceInterval ?? 1}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    recurrenceInterval: Number(e.target.value),
                    isRecurring: Number(e.target.value) > 1,
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
              <span className="text-xs text-gray-500">
                {(formData.recurrenceInterval ?? 1) === 1
                  ? "Repeats every week"
                  : `Repeats every ${formData.recurrenceInterval ?? 1} weeks`}
              </span>
            </div>
          </div>

          {/* Date Range */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Start Date *
              </label>
              <input
                type="date"
                value={formData.startDate?.toISOString().split("T")[0] || ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    startDate: new Date(e.target.value),
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                End Date (Optional)
              </label>
              <input
                type="date"
                value={formData.endDate?.toISOString().split("T")[0] || ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    endDate: e.target.value
                      ? new Date(e.target.value)
                      : undefined,
                  })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
              <span className="text-xs text-gray-500">
                Leave empty for ongoing schedule
              </span>
            </div>
          </div>

          {/* Weekly Schedule Patterns */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Weekly Schedule Pattern
                </label>
                <p className="text-sm text-gray-500">
                  Click days to toggle availability. Create multi-week patterns
                  for complex schedules.
                </p>
              </div>
              <button
                type="button"
                onClick={addWeek}
                className="px-3 py-2 text-sm bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200 flex items-center space-x-1"
              >
                <Plus className="h-4 w-4" />
                <span>Add Week</span>
              </button>
            </div>

            {weeklyPatterns.map((pattern, weekIndex) => (
              <div
                key={weekIndex}
                className="mb-6 p-4 border border-gray-200 rounded-lg"
              >
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-medium text-gray-900">
                    {weeklyPatterns.length > 1
                      ? `Week ${pattern.weekNumber}`
                      : "Weekly Schedule"}
                  </h4>
                  {weeklyPatterns.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeWeek(weekIndex)}
                      className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 flex items-center space-x-1"
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>Remove</span>
                    </button>
                  )}
                </div>

                {/* Day Grid */}
                <div className="grid grid-cols-7 gap-2 mb-4">
                  {dayNamesShort.map((dayName, dayOfWeek) => (
                    <div key={dayOfWeek} className="text-center">
                      <div className="text-xs font-medium text-gray-700 mb-2">
                        {dayName}
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleDayInPattern(weekIndex, dayOfWeek)}
                        className={`w-full h-12 rounded-md border-2 transition-colors text-sm font-medium ${
                          pattern.days[dayOfWeek]?.enabled
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white text-gray-700 border-gray-300 hover:border-blue-300"
                        }`}
                      >
                        {pattern.days[dayOfWeek]?.enabled ? "✓ ON" : "OFF"}
                      </button>
                    </div>
                  ))}
                </div>

                {/* Time Settings for Enabled Days */}
                <div className="space-y-2">
                  {Object.entries(pattern.days).map(([dayStr, dayData]) => {
                    const dayOfWeek = parseInt(dayStr);
                    if (!dayData.enabled) return null;

                    return (
                      <div
                        key={dayOfWeek}
                        className="flex items-center space-x-3 p-3 bg-blue-50 rounded-md"
                      >
                        <span className="font-medium text-sm w-16">
                          {dayNames[dayOfWeek]}
                        </span>
                        <input
                          type="time"
                          value={dayData.startTime}
                          onChange={(e) =>
                            updateDayTime(
                              weekIndex,
                              dayOfWeek,
                              "startTime",
                              e.target.value
                            )
                          }
                          className="px-3 py-1 text-sm border border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500"
                        />
                        <span className="text-gray-500">to</span>
                        <input
                          type="time"
                          value={dayData.endTime}
                          onChange={(e) =>
                            updateDayTime(
                              weekIndex,
                              dayOfWeek,
                              "endTime",
                              e.target.value
                            )
                          }
                          className="px-3 py-1 text-sm border border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Pattern Preview */}
            <div className="mt-4 p-3 bg-gray-50 rounded-md">
              <h5 className="font-medium text-sm text-gray-900 mb-2">
                Pattern Summary:
              </h5>
              <div className="text-sm text-gray-600">
                {weeklyPatterns.map((pattern, index) => {
                  const enabledDays = Object.entries(pattern.days)
                    .filter(([, dayData]) => dayData.enabled)
                    .map(([dayStr]) => dayNamesShort[parseInt(dayStr)]);

                  return (
                    <div key={index}>
                      {weeklyPatterns.length > 1 ? `Week ${index + 1}: ` : ""}
                      {enabledDays.length > 0
                        ? enabledDays.join(", ")
                        : "No days selected"}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {isSubmitting
                ? "Saving..."
                : schedule
                ? "Update Schedule"
                : "Create Schedule"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
