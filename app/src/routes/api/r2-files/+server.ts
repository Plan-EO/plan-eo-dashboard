import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const R2_BASE_URL = import.meta.env.VITE_R2_POINTS_BASE_URL;

export const GET: RequestHandler = async () => {
  try {
    // For public R2 buckets, we'll dynamically check for recent files
    // since R2 doesn't expose directory listing for public buckets
    
    // Try to fetch a manifest file first (if one exists)
    const manifestUrl = `${R2_BASE_URL}/manifest.json`;
    
    try {
      const manifestResponse = await fetch(manifestUrl);
      
      if (manifestResponse.ok) {
        const manifest = await manifestResponse.json();
        return json(manifest);
      }
    } catch (manifestError) {
      // Manifest doesn't exist, fall back to checking dates
    }
    
    // Check the last 14 days sequentially, stopping at the first found file.
    // Sequential + early-exit avoids hammering R2 with many concurrent HEAD requests.
    const today = new Date();
    let latestFile: { date: string; fileName: string; url: string } | null = null;

    for (let i = 0; i <= 14; i++) {
      const checkDate = new Date(today);
      checkDate.setDate(checkDate.getDate() - i);
      const dateStr = checkDate.toISOString().split('T')[0];
      const fileName = `${dateStr}_Plan-EO_Dashboard_point_data.csv`;
      const fileUrl = `${R2_BASE_URL}/${fileName}`;

      try {
        const response = await fetch(fileUrl, { method: 'HEAD' });
        if (response.ok) {
          latestFile = { date: dateStr, fileName, url: fileUrl };
          break; // Stop at the most recent file found
        }
      } catch {
        // File doesn't exist for this date, continue
      }
    }

    if (latestFile) {
      console.log(`Found latest R2 file: ${latestFile.fileName}`);
      return json({
        files: [latestFile],
        source: 'detected',
        lastChecked: new Date().toISOString()
      }, {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });
    }
    
    // If no files found, return a default file that should exist
    console.log('No files found in R2, using default');
    return json({
      files: [{
        date: '2025-08-25',
        fileName: '2025-08-25_Plan-EO_Dashboard_point_data.csv',
        url: `${R2_BASE_URL}/2025-08-25_Plan-EO_Dashboard_point_data.csv`
      }],
      source: 'default',
      lastChecked: new Date().toISOString()
    }, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
    
  } catch (error) {
    console.error('Error listing R2 files:', error);
    return json({ error: 'Failed to list files from R2' }, { status: 500 });
  }
};