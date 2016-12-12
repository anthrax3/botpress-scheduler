import Promise from 'bluebird'

import db from './db'
import util from './util'

let timerInterval = null

module.exports = (bp) => {

  const reschedule = task => {
    console.log('>>>>>', task)
    return Promise.resolve()
    if (task.schedule_type.toLowerCase() === 'once') {
      return Promise.resolve(null)
    }
    
    const nextOccurence = util.getNextOccurence(task.schedule_type, task.schedule)

    return db(bp).scheduleNext(task.id, nextOccurence.format('x'))
  }

  const run = () => {
    db(bp).listExpired()
    .then(list => {
      return Promise.map(list, expired => {
        let fromDate = null
        return reschedule(expired)
        .then(() => {
          db(bp).updateTask(expired.id, expired.scheduledOn, 'executing', null, null)
        })
        .then(() => {
          if (expired.enabled) {
            fromDate = new Date()
            var fn = new Function('bp', 'task', expired.action)
            bp.events.emit('scheduler.started', expired)
            return fn(bp, expired)
          } else {
            bp.logger.debug('[scheduler] Skipped task ' + expired.id + '. Reason=disabled')
          }
        })
        .then(result => {
          const returned = (result && result.toString && result.toString()) || result
          const logsQuery = {
            from: fromDate,
            until: new Date(),
            limit: 1000,
            start: 0,
            order: 'desc',
            fields: ['message']
          }
          let logsQueryPromise = Promise.resolve(null)
          if (expired.enabled) {
            logsQueryPromise = Promise.fromCallback(callback => bp.logger.query(logsQuery, callback))
          }

          return logsQueryPromise
          .then(logs => {
            return db(bp).updateTask(expired.id, expired.scheduledOn, 'done', logs, returned)
          })
          .then(() => {
            bp.events.emit('scheduler.finished', expired)
          })
        })
      })
    })
  }

  const revive = () => db(bp).reviveAllExecuting()
  const start = () => timerInterval = setInterval(run, 5000)
  const stop = () => clearInterval(timerInterval)

  return { start, stop, revive }
}
