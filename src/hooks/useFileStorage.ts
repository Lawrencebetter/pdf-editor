import { useState, useEffect, useCallback } from 'react';
import type { FileMetadata } from '@/types';
import { generateId } from '@/utils/fileUtils';

const STORAGE_KEY = 'pdf_editor_files';

export function useFileStorage() {
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setFiles(JSON.parse(stored));
      } catch {
        setFiles([]);
      }
    }
    setIsLoading(false);
  }, []);

  const saveFile = useCallback((name: string, size: number, pageCount: number): string => {
    const newFile: FileMetadata = {
      id: generateId(),
      name,
      size,
      uploadTime: new Date().toISOString(),
      pageCount,
    };
    
    setFiles((prevFiles) => {
      const updatedFiles = [newFile, ...prevFiles];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedFiles));
      return updatedFiles;
    });
    
    return newFile.id;
  }, []);

  const deleteFile = useCallback((id: string) => {
    setFiles((prevFiles) => {
      const updatedFiles = prevFiles.filter((f) => f.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedFiles));
      return updatedFiles;
    });
  }, []);

  const updateFile = useCallback((id: string, updates: Partial<FileMetadata>) => {
    setFiles((prevFiles) => {
      const updatedFiles = prevFiles.map((f) =>
        f.id === id ? { ...f, ...updates } : f
      );
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedFiles));
      return updatedFiles;
    });
  }, []);

  const clearAll = useCallback(() => {
    setFiles([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return {
    files,
    isLoading,
    saveFile,
    deleteFile,
    updateFile,
    clearAll,
  };
}

const PDF_DATA_KEY_PREFIX = 'pdf_data_';

export function usePDFDataStorage() {
  const savePDFData = useCallback((id: string, data: Uint8Array) => {
    const base64 = btoa(String.fromCharCode(...data));
    localStorage.setItem(`${PDF_DATA_KEY_PREFIX}${id}`, base64);
  }, []);

  const getPDFData = useCallback((id: string): Uint8Array | null => {
    const base64 = localStorage.getItem(`${PDF_DATA_KEY_PREFIX}${id}`);
    if (!base64) return null;
    const binary = atob(base64);
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  }, []);

  const deletePDFData = useCallback((id: string) => {
    localStorage.removeItem(`${PDF_DATA_KEY_PREFIX}${id}`);
  }, []);

  return {
    savePDFData,
    getPDFData,
    deletePDFData,
  };
}