/**
 * Formats text with italic markers (__text__) to HTML with <em> tags
 * @param text The text containing __text__ markers
 * @returns HTML string with <em> tags for italic text
 */
export function formatItalicText(text: string): string {
  if (!text) return '';
  
  // Replace __text__ with <em>text</em>
  return text.replace(/__([^_]+)__/g, '<em>$1</em>');
}

/**
 * Formats text with italic markers for display in plain text (removes markers)
 * @param text The text containing __text__ markers
 * @returns Plain text without markers
 */
export function stripItalicMarkers(text: string): string {
  if (!text) return '';
  
  // Remove __ markers
  return text.replace(/__([^_]+)__/g, '$1');
}

/**
 * Sorts items based on VAL field (e.g., "01_Age_PSAC", "02_Synd_Diar")
 * @param items Array of items to sort
 * @param getVal Function to extract VAL field from item
 * @returns Sorted array
 */
export function sortByValField<T>(items: T[], getVal: (item: T) => string | undefined): T[] {
  return [...items].sort((a, b) => {
    const valA = getVal(a) || '';
    const valB = getVal(b) || '';
    
    // Extract numeric prefix if present (e.g., "01" from "01_Age_PSAC")
    const numA = parseInt(valA.split('_')[0]) || 999;
    const numB = parseInt(valB.split('_')[0]) || 999;
    
    if (numA !== numB) {
      return numA - numB;
    }
    
    // If numbers are equal or not present, sort alphabetically
    return valA.localeCompare(valB);
  });
}

/**
 * Extracts clean label from VAL/LAB pair
 * @param valField The VAL field (e.g., "01_Age_PSAC")
 * @param labField The LAB field (e.g., "Pre-school age children (<5 years)")
 * @returns Clean label for display
 */
export function getCleanLabel(valField?: string, labField?: string): string {
  if (labField) {
    // Remove leading spaces if present
    return labField.trim();
  }
  
  if (valField) {
    // Extract label from VAL field if LAB not available
    // e.g., "01_Age_PSAC" -> "PSAC"
    const parts = valField.split('_');
    return parts[parts.length - 1] || valField;
  }
  
  return '';
}

/**
 * Parses text with one or more repeated ^^ prefixes for indentation (e.g. "^^" for
 * one level, "^^^^" for two levels) and returns the formatted text.
 * @param text The text potentially containing ^^ prefix(es)
 * @returns Object with indented flag, indent level (number of ^^ pairs), and cleaned text
 */
export function parseIndentationPrefix(text: string): { isIndented: boolean; level: number; text: string } {
  if (!text) return { isIndented: false, level: 0, text: '' };

  let level = 0;
  let rest = text;
  while (rest.startsWith('^^')) {
    level++;
    rest = rest.substring(2);
  }

  return {
    isIndented: level > 0,
    level,
    text: rest
  };
}

/**
 * Formats text with indentation prefix (^^) and italic markers (__text__)
 * @param text The text containing formatting markers
 * @returns HTML string with proper formatting
 */
export function formatDropdownText(text: string): string {
  if (!text) return '';
  
  // Parse indentation - remove ^^ prefix if present
  const { text: cleanText } = parseIndentationPrefix(text);
  
  // Apply italic formatting
  const formattedText = formatItalicText(cleanText);
  
  // Return the formatted text (indentation is now handled by the parent button)
  return formattedText;
}