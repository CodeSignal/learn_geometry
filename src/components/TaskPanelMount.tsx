import { useEffect, useRef, useState } from 'react';
import { TaskPanel, type TaskPanelConfig, type TaskPanelInstance } from '../shared/task-panel/task-panel.js';
import '../shared/task-panel/task-panel.css';

type TaskResponse = {
  task: TaskPanelConfig | null;
  submittedAnswer: string;
};

export function TaskPanelMount() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<TaskPanelInstance | null>(null);
  const [data, setData] = useState<TaskResponse | null>(null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('./api/task')
      .then((response) => {
        if (!response.ok) throw new Error(`task fetch failed: ${response.status}`);
        return response.json();
      })
      .then((value) => {
        if (!active) return;
        if (value && typeof value === 'object') {
          const task = (value as TaskResponse).task ?? null;
          const submittedAnswer = typeof (value as TaskResponse).submittedAnswer === 'string'
            ? (value as TaskResponse).submittedAnswer
            : '';
          setData({ task, submittedAnswer });
        } else {
          setErrored(true);
        }
      })
      .catch(() => {
        if (active) setErrored(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!data?.task || !containerRef.current) return;

    const panel = TaskPanel.init({
      container: containerRef.current,
      config: data.task,
      initialAnswer: data.submittedAnswer,
      onChange: (answer) => {
        fetch('./api/task/answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answer }),
        }).catch(() => {
          // Best-effort: the panel UI continues to reflect the local answer
          // even if the network call fails.
        });
      },
    });
    panelRef.current = panel;

    return () => {
      panel.destroy();
      panelRef.current = null;
    };
  }, [data]);

  if (errored || !data?.task) return null;
  return <div ref={containerRef} />;
}
