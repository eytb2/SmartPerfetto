#!/bin/bash

# SmartPerfetto Deployment Script
# Usage: ./scripts/deploy.sh [staging|production]

set -e

# Configuration
ENVIRONMENT=${1:-staging}
PROJECT_NAME="smart-perfetto"
COMPOSE_FILE="docker-compose.yml"
COMPOSE_PROD_FILE="docker-compose.prod.yml"
BACKUP_DIR="./backups"
LOG_FILE="./deploy-$(date +%Y%m%d-%H%M%S).log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}" | tee -a $LOG_FILE
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}" | tee -a $LOG_FILE
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}" | tee -a $LOG_FILE
}

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."

    # Check if Docker is installed
    if ! command -v docker &> /dev/null; then
        error "Docker is not installed"
        exit 1
    fi

    # Check if Docker Compose is installed
    if ! command -v docker-compose &> /dev/null; then
        error "Docker Compose is not installed"
        exit 1
    fi

    # Check if .env file exists
    if [ ! -f ".env" ]; then
        warn ".env file not found. Creating from template..."
        cp .env.example .env
        warn "Please edit .env file with your configuration before deploying"
        exit 1
    fi

    log "Prerequisites check completed"
}

# Backup current deployment
backup() {
    if [ "$ENVIRONMENT" = "production" ]; then
        log "Creating backup of current deployment..."

        # Create backup directory
        mkdir -p $BACKUP_DIR

        # Backup database if using PostgreSQL
        if docker-compose ps | grep -q postgres; then
            docker-compose exec postgres pg_dump -U $POSTGRES_USER $POSTGRES_DB > $BACKUP_DIR/db-backup-$(date +%Y%m%d-%H%M%S).sql
            log "Database backup created"
        fi

        # Backup uploads directory
        if [ -d "uploads" ]; then
            tar -czf $BACKUP_DIR/uploads-backup-$(date +%Y%m%d-%H%M%S).tar.gz uploads/
            log "Uploads backup created"
        fi
    fi
}

# Build and deploy
deploy() {
    log "Starting deployment for $ENVIRONMENT environment..."

    # Set environment variables
    export COMPOSE_FILE=$COMPOSE_FILE
    if [ "$ENVIRONMENT" = "production" ] && [ -f "$COMPOSE_PROD_FILE" ]; then
        export COMPOSE_FILE="$COMPOSE_FILE:$COMPOSE_PROD_FILE"
    fi

    # Pull latest images
    log "Pulling latest images..."
    docker-compose pull

    # Build custom images
    log "Building application images..."
    docker-compose build --no-cache

    # Stop old containers
    log "Stopping old containers..."
    docker-compose down

    # Start new containers
    log "Starting new containers..."
    docker-compose up -d

    # Wait for services to be healthy
    log "Waiting for services to be healthy..."
    sleep 30

    # Check service health
    check_health

    log "Deployment completed successfully!"
}

# Check service health
check_health() {
    log "Checking service health..."

    # Check API health
    API_URL="http://localhost:3001/health"
    if curl -f $API_URL > /dev/null 2>&1; then
        log "API service is healthy"
    else
        error "API service is not responding"
        exit 1
    fi

    # Check frontend
    if curl -f http://localhost > /dev/null 2>&1; then
        log "Frontend service is healthy"
    else
        error "Frontend service is not responding"
        exit 1
    fi

    log "All services are healthy"
}

# Rollback function
rollback() {
    warn "Rolling back to previous deployment..."

    # Stop current containers
    docker-compose down

    # Restore database backup if exists
    if [ "$ENVIRONMENT" = "production" ]; then
        LATEST_DB_BACKUP=$(ls -t $BACKUP_DIR/db-backup-*.sql 2>/dev/null | head -n1)
        if [ ! -z "$LATEST_DB_BACKUP" ]; then
            log "Restoring database from backup: $LATEST_DB_BACKUP"
            docker-compose up -d postgres
            sleep 10
            docker-compose exec postgres psql -U $POSTGRES_USER -d $POSTGRES_DB < $LATEST_DB_BACKUP
        fi

        # Restore uploads if exists
        LATEST_UPLOADS_BACKUP=$(ls -t $BACKUP_DIR/uploads-backup-*.tar.gz 2>/dev/null | head -n1)
        if [ ! -z "$LATEST_UPLOADS_BACKUP" ]; then
            log "Restoring uploads from backup: $LATEST_UPLOADS_BACKUP"
            tar -xzf $LATEST_UPLOADS_BACKUP
        fi
    fi

    log "Rollback completed"
}

# Cleanup old images and containers
cleanup() {
    log "Cleaning up old Docker images and containers..."

    # Remove unused images
    docker image prune -f

    # Remove unused containers
    docker container prune -f

    # Remove unused volumes (be careful with this in production)
    if [ "$ENVIRONMENT" != "production" ]; then
        docker volume prune -f
    fi

    log "Cleanup completed"
}

# Show usage
usage() {
    echo "Usage: $0 [staging|production] [command]"
    echo ""
    echo "Commands:"
    echo "  deploy    (default) Deploy the application"
    echo "  rollback  Rollback to the previous deployment"
    echo "  cleanup   Clean up old Docker resources"
    echo ""
    echo "Examples:"
    echo "  $0 staging"
    echo "  $0 production deploy"
    echo "  $0 production rollback"
}

# Main script
main() {
    log "Starting SmartPerfetto deployment..."

    # Set environment
    case $ENVIRONMENT in
        staging|production)
            ;;
        *)
            error "Invalid environment. Use 'staging' or 'production'"
            usage
            exit 1
            ;;
    esac

    # Check if command is provided
    COMMAND=${2:-deploy}

    case $COMMAND in
        deploy)
            check_prerequisites
            backup
            deploy
            ;;
        rollback)
            rollback
            ;;
        cleanup)
            cleanup
            ;;
        *)
            error "Invalid command"
            usage
            exit 1
            ;;
    esac

    log "Deployment script completed!"
}

# Handle script interruption
trap 'error "Script interrupted"; exit 1' INT

# Run main function with all arguments
main "$@"