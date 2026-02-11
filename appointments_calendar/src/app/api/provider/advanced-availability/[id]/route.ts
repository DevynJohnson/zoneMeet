import { NextRequest, NextResponse } from 'next/server';
import { AdvancedAvailabilityService } from '@/lib/advanced-availability-service';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const scheduleData = await request.json();
    
    const schedule = await AdvancedAvailabilityService.updateSchedule(id, scheduleData);
    return NextResponse.json(schedule);
  } catch (error) {
    console.error('Error updating advanced availability schedule:', error);
    return NextResponse.json(
      { error: 'Failed to update schedule' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const partialData = await request.json();
    
    // If we're just toggling the active status, use the dedicated method
    if ('isActive' in partialData && Object.keys(partialData).length === 1) {
      const schedule = await AdvancedAvailabilityService.toggleScheduleActive(id, partialData.isActive);
      return NextResponse.json(schedule);
    }
    
    // Otherwise use the general update method
    const schedule = await AdvancedAvailabilityService.updateSchedule(id, partialData);
    return NextResponse.json(schedule);
  } catch (error) {
    console.error('Error patching advanced availability schedule:', error);
    return NextResponse.json(
      { error: 'Failed to update schedule' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    await AdvancedAvailabilityService.deleteSchedule(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting advanced availability schedule:', error);
    return NextResponse.json(
      { error: 'Failed to delete schedule' },
      { status: 500 }
    );
  }
}