#!/usr/bin/env bash
# YOLO Autonomous Runtime - Force Non-Human-In-The-Loop (NHITL) environment
export APHRODY_YOLO=1
export APHRODY_NHITL=1
export APHRODY_AUTO_APPROVE=1
export APHRODY_NON_INTERACTIVE=1
export CI=true

echo "[yolo] Non-human-in-the-loop autonomous runtime active (NHITL=1, AUTO_APPROVE=1)"
