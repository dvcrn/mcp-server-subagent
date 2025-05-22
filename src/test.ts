#!/usr/bin/env node

import { v4 as uuidv4 } from 'uuid';
import { promises as fs } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';
import { createWriteStream } from 'fs';

// Define the log directory
const LOG_DIR = join(process.cwd(), 'logs');

// Ensure log directory exists
async function ensureLogDir() {
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
  } catch (error) {
    console.error("Error creating log directory:", error);
    throw error;
  }
}

// Test running a subagent
async function testRunSubagent() {
  const name = 'q';
  const input = 'What is AWS S3?';
  
  const runId = uuidv4();
  const logFile = join(LOG_DIR, `${name}-${runId}.log`);
  const metadataFile = join(LOG_DIR, `${name}-${runId}.meta.json`);
  
  // Prepare command and arguments
  const command = 'echo';
  const args = [`Simulating Q CLI with input: ${input}`];
  
  // Create log file stream for real-time logging
  const logStream = createWriteStream(logFile, { flags: 'a' });
  
  // Write initial metadata
  const metadata = {
    runId,
    command: `${command} ${args.join(' ')}`,
    startTime: new Date().toISOString(),
    status: 'running',
    exitCode: null,
    endTime: null
  };
  
  await fs.writeFile(metadataFile, JSON.stringify(metadata, null, 2));
  
  try {
    console.log(`Starting test run with ID: ${runId}`);
    
    // Use spawn for better stream handling
    const process = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    // Log timestamp at the beginning
    logStream.write(`[${new Date().toISOString()}] Starting ${name} with input: ${input}\n`);
    
    // Stream stdout to log file in real-time
    process.stdout.on('data', (data) => {
      const timestamp = new Date().toISOString();
      logStream.write(`[${timestamp}] [stdout] ${data}`);
      console.log(`[stdout] ${data}`);
    });
    
    // Stream stderr to log file in real-time
    process.stderr.on('data', (data) => {
      const timestamp = new Date().toISOString();
      logStream.write(`[${timestamp}] [stderr] ${data}`);
      console.log(`[stderr] ${data}`);
    });
    
    // Update metadata when process completes
    process.on('close', async (code) => {
      const endTime = new Date().toISOString();
      logStream.write(`[${endTime}] Process exited with code ${code}\n`);
      logStream.end();
      
      // Update metadata file with completion info
      const updatedMetadata = {
        ...metadata,
        status: code === 0 ? 'success' : 'error',
        exitCode: code,
        endTime
      };
      
      await fs.writeFile(metadataFile, JSON.stringify(updatedMetadata, null, 2));
      console.log(`Test run completed with code ${code}`);
      
      // Read and display the log file
      const logs = await fs.readFile(logFile, 'utf-8');
      console.log('\nLog file contents:');
      console.log(logs);
      
      // Read and display the metadata file
      const metadataContent = await fs.readFile(metadataFile, 'utf-8');
      console.log('\nMetadata file contents:');
      console.log(metadataContent);
    });
  } catch (error) {
    console.error('Error in test:', error);
  }
}

// Run the test
async function main() {
  await ensureLogDir();
  await testRunSubagent();
}

main().catch(error => {
  console.error('Test failed:', error);
});
