/* SPDX-License-Identifier: Apache-2.0 */
#ifndef APHRODY_WEB_PIPELINE_H
#define APHRODY_WEB_PIPELINE_H
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

/* Optional additive extension. Existing Aphrody/Web ABI revisions are unchanged. */
uint32_t aphrody_web_pipeline_abi_version(void);
/* Workflows still running, including cancellation waiting for local teardown. */
uint64_t aphrody_web_pipeline_pending_count(void);
/* args_json is borrowed for this call and copied before return. No CLI process
 * or process-wide stdio capture. Omit the aphrody web prefix. timeout_ms=0 means
 * no deadline. Poll/cancel with aphrody_web_job_*; free taken strings with
 * aphrody_web_free_string. */
uint64_t aphrody_web_pipeline_submit(const char *args_json, uint32_t timeout_ms);
/* Existing command surface, in process on persistent native workers. Arguments
 * omit aphrody. Returns {code,stdout,stderr} through the same jobs. Compatibility
 * stdio captures are serialized; typed Web workflows remain independent. */
uint64_t aphrody_command_submit(const char *args_json, uint32_t timeout_ms);
/* Existing HTTP MCP client; no stdio capture or subprocess. request_json is
 * {config?:path,server:name,tool:name,arguments:object}. Native config resolves
 * authenticated transport and sessions. Returns {server,tool,result}. */
uint64_t aphrody_mcp_tool_submit(const char *request_json, uint32_t timeout_ms);

#ifdef __cplusplus
}
#endif
#endif
