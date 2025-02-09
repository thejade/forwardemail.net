/**
 * Copyright (c) Forward Email LLC
 * SPDX-License-Identifier: BUSL-1.1
 */

// eslint-disable-next-line import/no-unassigned-import
require('#config/env');

const process = require('node:process');
const { parentPort } = require('node:worker_threads');

// eslint-disable-next-line import/no-unassigned-import
require('#config/mongoose');

const Graceful = require('@ladjs/graceful');
const mongoose = require('mongoose');

const Domains = require('#models/domains');
const Users = require('#models/users');
const logger = require('#helpers/logger');
const setupMongoose = require('#helpers/setup-mongoose');
const monitorServer = require('#helpers/monitor-server');

monitorServer();

const graceful = new Graceful({
  mongooses: [mongoose],
  logger
});

graceful.listen();

(async () => {
  await setupMongoose(logger);

  try {
    // aggregating users and calculating domain count
    const usersWithDomainCount = await Users.aggregate([
      {
        $match: {}
      },
      {
        $lookup: {
          from: 'domains',
          let: { userId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $in: ['$$userId', '$members.user']
                }
              }
            },
            {
              $addFields: {
                adminMembers: {
                  $filter: {
                    input: '$members',
                    as: 'member',
                    cond: {
                      $and: [
                        { $eq: ['$$member.user', '$$userId'] },
                        { $eq: ['$$member.group', 'admin'] }
                      ]
                    }
                  }
                }
              }
            },
            {
              $match: {
                adminMembers: { $ne: [] }
              }
            }
          ],
          as: 'domainsWithAdminMember'
        }
      },
      {
        $addFields: {
          domain_count: { $size: '$domainsWithAdminMember' }
        }
      }
    ]);

    // bulk update users with domain_count
    if (usersWithDomainCount.length > 0) {
      const bulkUserOperations = usersWithDomainCount.map((user) => ({
        updateOne: {
          filter: { _id: user._id },
          update: { $set: { domain_count: user.domain_count } }
        }
      }));

      await Users.bulkWrite(bulkUserOperations);
    }

    // aggregating domains and calculating alias count
    const domainsWithAliases = await Domains.aggregate([
      {
        $lookup: {
          from: 'aliases',
          localField: '_id',
          foreignField: 'domain',
          as: 'matchingAliases'
        }
      },
      {
        $addFields: {
          alias_count: { $size: '$matchingAliases' }
        }
      },
      {
        $project: {
          _id: 1,
          domain_name: 1,
          alias_count: 1
        }
      }
    ]);

    // bulk update domains with alias_count
    if (domainsWithAliases.length > 0) {
      const bulkDomainOperations = domainsWithAliases.map((domain) => ({
        updateOne: {
          filter: { _id: domain._id },
          update: { $set: { alias_count: domain.alias_count } }
        }
      }));

      await Domains.bulkWrite(bulkDomainOperations);
    }
  } catch (err) {
    await logger.error(err);
  }

  if (parentPort) parentPort.postMessage('done');
  else process.exit(0);
})();
