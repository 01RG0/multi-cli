package queue

import (
	"context"
	"log"
)

type WorkerPool struct {
	concurrency int
	queue       *Queue
	sem         chan struct{}
	handler     func(ctx context.Context, task Task) (string, error)
}

func NewWorkerPool(concurrency int, q *Queue, handler func(context.Context, Task) (string, error)) *WorkerPool {
	return &WorkerPool{
		concurrency: concurrency,
		queue:       q,
		sem:         make(chan struct{}, concurrency),
		handler:     handler,
	}
}

// Start runs the worker loop until ctx is cancelled.
func (wp *WorkerPool) Start(ctx context.Context) {
	for {
		task, err := wp.queue.Dequeue(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Printf("worker: dequeue error: %v", err)
			continue
		}

		wp.sem <- struct{}{} // acquire slot
		go func(t Task) {
			defer func() { <-wp.sem }()
			result, err := wp.handler(ctx, t)
			if err != nil {
				if qErr := wp.queue.Fail(t.ID, err.Error()); qErr != nil {
					log.Printf("worker: fail task %s: %v", t.ID, qErr)
				}
				return
			}
			if qErr := wp.queue.Complete(t.ID, result); qErr != nil {
				log.Printf("worker: complete task %s: %v", t.ID, qErr)
			}
		}(task)
	}
}
