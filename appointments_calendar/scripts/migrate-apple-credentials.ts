/**
 * Migration script to update legacy Apple Calendar credentials to new format
 * 
 * This script converts Apple Calendar connections from legacy format (plain password)
 * to the new format (base64-encoded JSON with appleId and appSpecificPassword).
 * 
 * Usage: npx tsx scripts/migrate-apple-credentials.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrateAppleCredentials() {
  console.log('🔍 Starting Apple Calendar credentials migration...\n');

  try {
    // Find all Apple calendar connections
    const connections = await prisma.calendarConnection.findMany({
      where: {
        platform: 'APPLE',
        isActive: true,
      },
    });

    console.log(`📊 Found ${connections.length} Apple Calendar connection(s)\n`);

    let migrated = 0;
    let alreadyMigrated = 0;
    let failed = 0;

    for (const connection of connections) {
      console.log(`\n🔄 Processing connection ${connection.id} (${connection.email})...`);

      try {
        // Try to decode and parse as JSON (new format)
        const decoded = Buffer.from(connection.accessToken, 'base64').toString('utf8');
        const credentials = JSON.parse(decoded);

        // If we can parse it as JSON, it's already in the new format
        if (credentials.appleId && credentials.appSpecificPassword) {
          console.log(`   ✅ Already in new format`);
          alreadyMigrated++;
          continue;
        }
      } catch {
        // Not JSON, need to migrate
      }

      // Try to decode as legacy format
      try {
        const decoded = Buffer.from(connection.accessToken, 'base64').toString('utf8');

        let appleId = connection.email;
        let appSpecificPassword = '';

        // Check if it's in "email:password" format
        if (decoded.includes(':')) {
          const parts = decoded.split(':', 2);
          appleId = parts[0].trim();
          appSpecificPassword = parts[1].trim();
          console.log(`   📝 Detected email:password format`);
        } else {
          // It's just the password, use email from connection
          appSpecificPassword = decoded;
          console.log(`   📝 Detected plain password format`);
        }

        if (!appleId || !appSpecificPassword) {
          console.log(`   ❌ Failed: Missing credentials`);
          failed++;
          continue;
        }

        // Create new format
        const newCredentials = {
          appleId: appleId,
          appSpecificPassword: appSpecificPassword,
        };
        const encodedCredentials = Buffer.from(JSON.stringify(newCredentials)).toString('base64');

        // Update the connection
        await prisma.calendarConnection.update({
          where: { id: connection.id },
          data: {
            accessToken: encodedCredentials,
            email: appleId, // Ensure email is set correctly
          },
        });

        console.log(`   ✅ Successfully migrated to new format`);
        migrated++;
      } catch (error) {
        console.log(`   ❌ Failed: ${error instanceof Error ? error.message : String(error)}`);
        failed++;
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Migration Summary:');
    console.log(`   ✅ Migrated: ${migrated}`);
    console.log(`   ⏭️  Already migrated: ${alreadyMigrated}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log('='.repeat(60) + '\n');

    if (migrated > 0) {
      console.log('✅ Migration completed successfully!');
      console.log('ℹ️  Your Apple Calendar will now sync without warnings.\n');
    } else if (alreadyMigrated > 0) {
      console.log('ℹ️  All connections already in new format. No migration needed.\n');
    } else {
      console.log('⚠️  No connections were migrated.\n');
    }
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the migration
migrateAppleCredentials();
