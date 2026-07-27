import { useOptimisticActions } from '@/hooks/use-optimistic-actions';
import { m } from '@/paraglide/messages';
import { useState } from 'react';
import { toast } from 'sonner';

const useDelete = () => {
  const [isLoading, setIsLoading] = useState(false);
  const { permanentlyDeleteThreads } = useOptimisticActions();

  return {
    mutate: (id: string, type: 'thread' | 'email' = 'thread') => {
      setIsLoading(true);
      return toast.promise(permanentlyDeleteThreads([id]), {
        loading: m['common.actions.deletingMail'](),
        success: m['common.actions.deletedMail'](),
        error: (error) => {
          console.error(`Error deleting ${type}:`, error);

          return m['common.actions.failedToDeleteMail']();
        },
        finally: async () => {
          setIsLoading(false);
        },
      });
    },
    isLoading,
  };
};

export default useDelete;
