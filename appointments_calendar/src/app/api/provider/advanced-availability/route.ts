import { NextRequest, NextResponse } from 'next/server';
import { AdvancedAvailabilityService } from '@/lib/advanced-availability-service';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const templateId = searchParams.get('templateId');

    if (!templateId) {
      return NextResponse.json({ error: 'Template ID is required' }, { status: 400 });
    }

    // Get all schedules including inactive ones for UI display
    const schedules = await AdvancedAvailabilityService.getSchedulesForTemplate(templateId, false);
    return NextResponse.json(schedules);
  } catch (error) {
    console.error('Error fetching advanced availability schedules:', error);
    return NextResponse.json(
      { error: 'Failed to fetch schedules' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { templateId, scheduleData } = body;
    
    if (!templateId || !scheduleData) {
      return NextResponse.json({ error: 'Template ID and schedule data are required' }, { status: 400 });
    }
    
    const schedule = await AdvancedAvailabilityService.createSchedule(templateId, scheduleData);
    return NextResponse.json(schedule);
  } catch (error) {
    console.error('Error creating advanced availability schedule:', error);
    return NextResponse.json(
      { error: 'Failed to create schedule' },
      { status: 500 }
    );
  }
}